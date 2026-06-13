import { Contract, Signer, ethers, keccak256, solidityPacked } from "ethers";
import { CORE_KEY_BY_ID, coreForOpcode } from "./isa";
import {
  collectExternalTensorIds,
  batchStepsToAbi,
  packBatchStep,
  packInstructionCalldata,
  seedStepFromTensor,
} from "./postman";
import { TensorStore } from "./tensor-store";
import { CompiledInstruction, CompiledProgram, DispatchResult } from "./types";
import { hashProgram } from "./verify";
import { tensorId } from "./tensor-id";
import { publishHcsMessage } from "../hcs";
import {
  batchFitsCalldataLimit,
  groupInstructionBatches,
  hashInstructionBatch,
  resolveDispatchMode,
  resolveSamplesPerTx,
} from "./batch";
import { Op } from "./isa";
import {
  dispatchShardedAdam,
  dispatchShardedBackwardMatmul,
  dispatchShardedSgd,
  isTransposeMatmulPair,
  needsShardedAdam,
  needsShardedSgd,
  needsShardedTranspose,
} from "./shard-dispatch";
import { instructionFitsCalldataLimit } from "./calldata";
import { dispatchGreedyBatches, splitIntoSampleRuns } from "./fast-dispatch";
import { StepLogger } from "../logger";
import { DeploymentAddresses } from "../types";
import { TX_GAS_LIMIT } from "../config";
import { sendAndWaitContract } from "../tx-utils";
import { DispatchStats } from "../dispatch-stats";
import { hydrateBatchReceipt, hydrateSingleReceipt } from "./hydrate";
import { isPinataEnabled } from "../ipfs/pinata";
import { sendBatchExecute } from "./batch-send";
import { publishAcpStatus } from "../protocols/acp";
import { reimburseGasReceipt, type MppContext } from "../protocols/mpp";

async function maybePublishHcs(
  topicId: string,
  type: "PROGRAM_START" | "INSTRUCTION" | "PROGRAM_END" | "COMMIT_WEIGHTS" | "BATCH_EXECUTE",
  payload: Record<string, unknown>,
  log?: StepLogger,
  stats?: DispatchStats
): Promise<{ sequenceNumber: number; messageHash: string }> {
  stats?.markHcs();
  const r = await publishHcsMessage(topicId, type as never, payload as never, log);
  return { sequenceNumber: r.sequenceNumber, messageHash: r.messageHash };
}

function hcsBatchAuditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CPU_HCS_BATCH_AUDIT ?? "1") !== "0";
}

async function publishBatchExecuteHcs(
  ctx: DispatcherContext,
  program: CompiledProgram,
  batchIndex: number,
  batch: CompiledInstruction[],
  batchHash: string,
  stats?: DispatchStats,
  payload?: { payloadHash?: string; ipfsCid?: string }
): Promise<{ sequenceNumber: number; messageHash: string }> {
  if (!hcsBatchAuditEnabled()) {
    const messageHash = keccak256(
      new TextEncoder().encode(
        JSON.stringify({ type: "BATCH_EXECUTE", job_id: program.jobId, batch_index: batchIndex, batch_hash: batchHash })
      )
    );
    return { sequenceNumber: batchIndex, messageHash };
  }
  return maybePublishHcs(
    ctx.topicId,
    "BATCH_EXECUTE",
    {
      job_id: program.jobId,
      batch_index: batchIndex,
      batch_hash: batchHash,
      ops: batch.length,
      first_op: batch[0]?.op,
      last_op: batch[batch.length - 1]?.op,
      ipfs_mode: isPinataEnabled(),
      payload_hash: payload?.payloadHash,
      ipfs_cid: payload?.ipfsCid?.replace(/^ipfs:\/\//, ""),
    },
    ctx.log,
    stats
  );
}

export interface DispatcherContext {
  deployment: DeploymentAddresses;
  signer: Signer;
  topicId: string;
  log?: StepLogger;
  mppContext?: MppContext;
  acpOrderId?: string;
  totalBatches?: number;
}

function coreContract(ctx: DispatcherContext, coreKey: string): Contract {
  const addr = ctx.deployment.cores[coreKey as keyof typeof ctx.deployment.cores];
  const abi = [
    "function execute(bytes32 jobId, uint64 hcsSeq, bytes32 messageHash, bytes32 outTensorId, uint8 opcode, uint16[] inShape, int256[] inData, uint16[] outShape, int256[] params)",
  ];
  return new Contract(addr, abi, ctx.signer);
}

function batchExecutorContract(ctx: DispatcherContext): Contract {
  if (!ctx.deployment.cpuBatchExecutor) {
    throw new Error("cpuBatchExecutor not deployed — run npm run deploy");
  }
  const abi = [
    "function executeBatch(bytes32 jobId, uint64 batchIndex, bytes32 batchHash, tuple(bytes32 outTensorId, uint8 opcode, bytes32[] inputTensorIds, uint16[] inShape, int256[] literalData, uint16[] outShape, int256[] params)[] steps)",
    "function executeBatchPacked(bytes32 jobId, uint64 batchIndex, bytes32 batchHash, bytes32 payloadHash, bytes packed)",
  ];
  return new Contract(ctx.deployment.cpuBatchExecutor, abi, ctx.signer);
}

function applyOptimizerAliases(
  program: CompiledProgram,
  inst: CompiledInstruction,
  store: TensorStore
): void {
  const optMatch = inst.op.match(/^(SGD|ADAM)_(W|B)(\d+)$/);
  if (!optMatch) return;

  const [, opt, kind, layer] = optMatch;
  const baseName = `${kind}${layer}`;
  const out = store.require(program.jobId, inst.output);
  const divisor = opt === "ADAM" ? 4 : 1;
  const n = out.data.length / divisor;
  const weightData = opt === "ADAM" ? out.data.slice(0, n) : out.data;

  const wRef = inst.inputs.W ? store.get(program.jobId, inst.inputs.W) : undefined;
  const wShape = wRef?.shape?.length ? wRef.shape : [n];

  store.put({
    jobId: program.jobId,
    tensorId: tensorId(baseName),
    shape: wShape,
    data: [...weightData],
    hcsSeq: out.hcsSeq,
    messageHash: out.messageHash,
  });

  if (opt === "ADAM") {
    const mRef = inst.inputs.m ? store.get(program.jobId, inst.inputs.m) : undefined;
    const vRef = inst.inputs.v ? store.get(program.jobId, inst.inputs.v) : undefined;
    const mvShape = mRef?.shape?.length ? mRef.shape : [n];
    const vShape = vRef?.shape?.length ? vRef.shape : mvShape;

    store.put({
      jobId: program.jobId,
      tensorId: tensorId(`m${baseName}`),
      shape: mvShape,
      data: [...out.data.slice(n, 2 * n)],
      hcsSeq: out.hcsSeq,
      messageHash: out.messageHash,
    });
    store.put({
      jobId: program.jobId,
      tensorId: tensorId(`v${baseName}`),
      shape: vShape,
      data: [...out.data.slice(2 * n, 3 * n)],
      hcsSeq: out.hcsSeq,
      messageHash: out.messageHash,
    });
  }
}

export async function registerCpuJob(
  ctx: DispatcherContext,
  program: CompiledProgram
) {
  const registryAbi = [
    "function registerJob(bytes32 jobId, bytes32 dataHash, string hcsTopicId, tuple(address linearCore, address activationCore, address gradientCore, address optimizerCore, address aggregationCore) cores)",
  ];
  const registry = new Contract(ctx.deployment.cpuJobRegistry, registryAbi, ctx.signer);
  return sendAndWaitContract(
    registry,
    "registerJob",
    [
      program.jobId,
      program.dataHash.startsWith("0x") ? program.dataHash : `0x${program.dataHash}`,
      ctx.topicId,
      {
        linearCore: ctx.deployment.cores.linear,
        activationCore: ctx.deployment.cores.activation,
        gradientCore: ctx.deployment.cores.gradient,
        optimizerCore: ctx.deployment.cores.optimizer,
        aggregationCore: ctx.deployment.cores.aggregation,
      },
    ],
    { gasLimit: TX_GAS_LIMIT }
  );
}

async function dispatchSingleInstruction(
  ctx: DispatcherContext,
  program: CompiledProgram,
  inst: CompiledInstruction,
  store: TensorStore,
  txHashes: string[],
  acks: { hcsSeq: number; opcode: number; messageHash: string }[],
  next?: CompiledInstruction
): Promise<boolean> {
  const hcs = await maybePublishHcs(
    ctx.topicId,
    "INSTRUCTION",
    {
      job_id: program.jobId,
      seq: inst.seq,
      op: inst.op,
      opcode: inst.opcode,
      outputs: { out: inst.output },
    },
    ctx.log
  );

  const coreKey = CORE_KEY_BY_ID[coreForOpcode(inst.opcode)];
  const core = coreContract(ctx, coreKey);
  let receipt;

  if (isTransposeMatmulPair(inst, next) && needsShardedTranspose(program.jobId, inst, store)) {
    await maybePublishHcs(
      ctx.topicId,
      "INSTRUCTION",
      {
        job_id: program.jobId,
        seq: next!.seq,
        op: next!.op,
        opcode: next!.opcode,
        outputs: { out: next!.output },
      },
      ctx.log
    );
    receipt = await dispatchShardedBackwardMatmul(
      ctx,
      program,
      inst,
      next!,
      store,
      coreKey,
      hcs.sequenceNumber,
      hcs.messageHash
    );
    txHashes.push(receipt.hash);
    acks.push({ hcsSeq: hcs.sequenceNumber, opcode: inst.opcode, messageHash: hcs.messageHash });
    acks.push({ hcsSeq: hcs.sequenceNumber, opcode: next!.opcode, messageHash: hcs.messageHash });
    return true;
  }

  if (inst.opcode === Op.ADAM && needsShardedAdam(program.jobId, inst, store)) {
    receipt = await dispatchShardedAdam(
      ctx,
      program,
      inst,
      store,
      coreKey,
      hcs.sequenceNumber,
      hcs.messageHash
    );
  } else if (inst.opcode === Op.SGD && needsShardedSgd(program.jobId, inst, store)) {
    receipt = await dispatchShardedSgd(
      ctx,
      program,
      inst,
      store,
      coreKey,
      hcs.sequenceNumber,
      hcs.messageHash
    );
  } else {
    const packed = packInstructionCalldata(program.jobId, inst, store);
    if (
      !instructionFitsCalldataLimit(
        program.jobId,
        inst.opcode,
        packed.inShape,
        packed.inData,
        packed.outShape,
        packed.params
      )
    ) {
      throw new Error(
        `Instruction ${inst.op} exceeds Hedera calldata limit (${packed.inData.length} elements)`
      );
    }
    receipt = await sendAndWaitContract(
      core,
      "execute",
      [
        program.jobId,
        hcs.sequenceNumber,
        hcs.messageHash,
        packed.outTensorId,
        inst.opcode,
        packed.inShape,
        packed.inData,
        packed.outShape,
        packed.params,
      ],
      { gasLimit: TX_GAS_LIMIT }
    );
    await hydrateSingleReceipt(
      store,
      receipt,
      await core.getAddress(),
      inst.opcode,
      packed.inShape,
      packed.inData,
      packed.outShape,
      packed.params,
      packed.outTensorId,
      ctx.signer,
      { log: ctx.log }
    );
  }

  txHashes.push(receipt.hash);
  acks.push({ hcsSeq: hcs.sequenceNumber, opcode: inst.opcode, messageHash: hcs.messageHash });
  applyOptimizerAliases(program, inst, store);
  return false;
}

async function dispatchBatch(
  ctx: DispatcherContext,
  program: CompiledProgram,
  batchIndex: number,
  batch: CompiledInstruction[],
  store: TensorStore,
  txHashes: string[],
  acks: { hcsSeq: number; opcode: number; messageHash: string }[],
  stats?: DispatchStats
): Promise<void> {
  const batchHash = hashInstructionBatch(batch);
  const externalIds = collectExternalTensorIds(batch);
  const seedSteps = externalIds.map((id) =>
    seedStepFromTensor(store.require(program.jobId, id))
  );
  const available = new Set<string>(externalIds);
  const steps = [
    ...seedSteps,
    ...batch.map((inst) => {
      const step = packBatchStep(inst, available);
      available.add(inst.output);
      return step;
    }),
  ];
  const executor = batchExecutorContract(ctx);

  const { receipt, payloadHash, ipfsCid } = await sendBatchExecute(
    executor,
    program.jobId,
    batchIndex,
    batchHash,
    steps,
    { stats, log: ctx.log }
  );
  const hcs = await publishBatchExecuteHcs(
    ctx,
    program,
    batchIndex,
    batch,
    batchHash,
    stats,
    { payloadHash, ipfsCid }
  );
  stats?.markBatchExecute();
  txHashes.push(receipt.hash);
  await hydrateBatchReceipt(
    store,
    receipt,
    await executor.getAddress(),
    steps,
    ctx.deployment,
    ctx.signer,
    { log: ctx.log }
  );

  for (const inst of batch) {
    acks.push({ hcsSeq: hcs.sequenceNumber, opcode: inst.opcode, messageHash: hcs.messageHash });
    applyOptimizerAliases(program, inst, store);
  }

  await reimburseGasReceipt({
    ctx: ctx.mppContext,
    batchIndex,
    receipt,
    log: ctx.log,
  });

  if (ctx.acpOrderId && ctx.totalBatches && ctx.totalBatches > 0) {
    const progressPct = Math.min(
      99,
      Math.round(((batchIndex + 1) / ctx.totalBatches) * 100)
    );
    await publishAcpStatus(
      ctx.topicId,
      {
        order_id: ctx.acpOrderId,
        status: "PROCESSING",
        progress_pct: progressPct,
        message: `Batch ${batchIndex + 1}/${ctx.totalBatches} executed`,
      },
      ctx.log
    );
  }
}

export async function dispatchProgram(
  ctx: DispatcherContext,
  program: CompiledProgram
): Promise<DispatchResult> {
  const store = new TensorStore();
  const txHashes: string[] = [];
  const acks: { hcsSeq: number; opcode: number; messageHash: string }[] = [];
  const stats = new DispatchStats();
  let mode = resolveDispatchMode();
  const samplesPerTx = resolveSamplesPerTx();

  await maybePublishHcs(
    ctx.topicId,
    "PROGRAM_START",
    {
      job_id: program.jobId,
      data_hash: program.dataHash,
      architecture: program.architecture,
      dispatch_mode: mode,
      samples_per_tx: samplesPerTx,
    },
    ctx.log,
    stats
  );

  if (mode === "batch") {
    const batches = groupInstructionBatches(program.instructions, samplesPerTx);
    const initBatches = batches.filter((b) => b[0]?.op.startsWith("INIT"));
    let sampleBatches = batches.filter((b) => !b[0]?.op.startsWith("INIT"));

    for (let bi = 0; bi < initBatches.length; bi++) {
      ctx.log?.info(`Init batch ${bi + 1}/${initBatches.length} (${initBatches[bi].length} ops)`);
      await dispatchBatch(ctx, program, bi, initBatches[bi], store, txHashes, acks, stats);
    }

    let runSampleBatches = sampleBatches.length > 0;
    let activeSamplesPerTx = samplesPerTx;
    while (
      runSampleBatches &&
      sampleBatches.some((b) => !batchFitsCalldataLimit(program.jobId, b, store)) &&
      activeSamplesPerTx > 1
    ) {
      activeSamplesPerTx = Math.max(1, Math.floor(activeSamplesPerTx / 2));
      sampleBatches = groupInstructionBatches(program.instructions, activeSamplesPerTx).filter(
        (b) => !b[0]?.op.startsWith("INIT")
      );
      ctx.log?.info(`Reducing SAMPLES_PER_TX to ${activeSamplesPerTx} for calldata limit`);
    }

    if (
      runSampleBatches &&
      sampleBatches.some((b) => !batchFitsCalldataLimit(program.jobId, b, store))
    ) {
      ctx.log?.info(
        "Sample batch exceeds Hedera 128KB calldata — fast greedy batch per sample"
      );
      runSampleBatches = false;
    }

    if (runSampleBatches) {
      ctx.totalBatches = initBatches.length + sampleBatches.length;
      ctx.log?.info(
        `Batch dispatch: ${ctx.totalBatches} TXs for ${program.instructions.length} ops (${samplesPerTx} samples/TX)`
      );
      for (let si = 0; si < sampleBatches.length; si++) {
        const bi = initBatches.length + si;
        const batch = sampleBatches[si];
        ctx.log?.info(
          `Sample batch ${si + 1}/${sampleBatches.length} (${batch.length} ops, ×${countSamplesInBatch(batch)})`
        );
        await dispatchBatch(ctx, program, bi, batch, store, txHashes, acks, stats);
        ctx.log?.progress(bi + 1, initBatches.length + sampleBatches.length, `batch ${bi + 1}`);
      }
    } else {
      const trainOps = program.instructions.filter((i) => !i.op.startsWith("INIT"));
      const sampleRuns = splitIntoSampleRuns(trainOps);
      const executor = batchExecutorContract(ctx);
      let bi = initBatches.length;
      ctx.log?.info(
        `Fast greedy batch: ${sampleRuns.length} samples, ${trainOps.length} ops`
      );
      const hooks = {
        batchExecutor: executor,
        coreContract: (coreKey: string) => coreContract(ctx, coreKey),
        stats,
        hydrateOptions: { log: ctx.log },
        onGasReceipt: ctx.mppContext
          ? async (batchIndex: number, receipt: { gasUsed: bigint; gasPrice?: bigint | null }) => {
              await reimburseGasReceipt({
                ctx: ctx.mppContext,
                batchIndex,
                receipt,
                log: ctx.log,
              });
            }
          : undefined,
        onBatch: async (
          batchIndex: number,
          batch: CompiledInstruction[],
          batchHash: string,
          payload?: { payloadHash?: string; ipfsCid?: string }
        ) => {
          const hcs = await publishBatchExecuteHcs(
            ctx,
            program,
            batchIndex,
            batch,
            batchHash,
            stats,
            payload
          );
          for (const inst of batch) {
            acks.push({
              hcsSeq: hcs.sequenceNumber,
              opcode: inst.opcode,
              messageHash: hcs.messageHash,
            });
          }
        },
        onTx: (hash: string) => txHashes.push(hash),
        applyAliases: (inst: CompiledInstruction) =>
          applyOptimizerAliases(program, inst, store),
      };
      for (let si = 0; si < sampleRuns.length; si++) {
        const run = sampleRuns[si];
        bi = await dispatchGreedyBatches(ctx, program, run, bi, store, hooks);
        const last = run[run.length - 1];
        ctx.log?.progress(
          last.seq + 1,
          program.instructions.length,
          `sample ${si + 1}/${sampleRuns.length}`
        );
      }
    }
  } else {
    const ops = program.instructions;
    for (let i = 0; i < ops.length; i++) {
      const inst = ops[i];
      const skipped = await dispatchSingleInstruction(
        ctx,
        program,
        inst,
        store,
        txHashes,
        acks,
        ops[i + 1]
      );
      ctx.log?.progress(inst.seq + 1, program.instructions.length, inst.op);
      if (skipped) i++;
    }
  }

  await maybePublishHcs(
    ctx.topicId,
    "PROGRAM_END",
    {
      job_id: program.jobId,
      instructions: program.instructions.length,
      tx_count: txHashes.length,
      dispatch_stats: stats.summaryLine(),
      ipfs_mode: isPinataEnabled(),
    },
    ctx.log,
    stats
  );

  ctx.log?.info(`Dispatch complete: ${stats.summaryLine()}`);

  let packed = "0x";
  for (const a of acks) {
    packed = solidityPacked(
      ["bytes", "uint64", "uint8", "bytes32"],
      [packed, a.hcsSeq, a.opcode, a.messageHash]
    );
  }
  const eventLogHash = keccak256(packed);

  const finalWeights = new Map<string, NonNullable<ReturnType<TensorStore["get"]>>>();
  for (const wId of program.weightTensorIds) {
    const t = store.get(program.jobId, wId);
    if (t) finalWeights.set(wId, t);
  }

  return {
    txHashes,
    programHash: hashProgram(program),
    eventLogHash,
    finalWeights,
    store,
  };
}

function countSamplesInBatch(batch: CompiledInstruction[]): number {
  return batch.filter((i) => i.op === "LOAD_X").length;
}
