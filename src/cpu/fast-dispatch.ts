import { CORE_KEY_BY_ID, Op, coreForOpcode } from "./isa";
import {
  batchFitsCalldataLimit,
  hashInstructionBatch,
  MAX_BATCH_CALLDATA_BYTES,
} from "./batch";
import {
  maxAdamShardElementsInBatch,
  maxSgdShardElements,
} from "./calldata";
import { encodeBatchCalldataBytes } from "./calldata";
import {
  BatchStepCalldata,
  collectExternalTensorIds,
  batchStepsToAbi,
  packBatchStep,
  seedStepFromTensor,
} from "./postman";
import { CompiledInstruction, CompiledProgram } from "./types";
import { TensorStore } from "./tensor-store";
import { needsShardedAdam, needsShardedSgd, ShardDispatchContext } from "./shard-dispatch";
import { tensorId } from "./tensor-id";
import { TX_GAS_LIMIT } from "../config";
import { sendAndWaitContract } from "../tx-utils";
import { instructionFitsCalldataLimit } from "./calldata";
import { packInstructionCalldata } from "./postman";
import type { DispatchStats } from "../dispatch-stats";
import { Contract, ContractTransactionReceipt } from "ethers";
import { hydrateBatchReceipt, hydrateSingleReceipt, HydrateOptions } from "./hydrate";
import { sendBatchExecute } from "./batch-send";

export interface BatchPayloadRef {
  payloadHash?: string;
  ipfsCid?: string;
}

export interface FastDispatchHooks {
  onBatch?: (
    batchIndex: number,
    batch: CompiledInstruction[],
    batchHash: string,
    payload?: BatchPayloadRef
  ) => Promise<void>;
  onGasReceipt?: (batchIndex: number, receipt: ContractTransactionReceipt) => Promise<void>;
  onTx: (hash: string) => void;
  applyAliases: (inst: CompiledInstruction) => void;
  batchExecutor: Contract;
  coreContract: (coreKey: string) => Contract;
  stats?: DispatchStats;
  hydrateOptions?: HydrateOptions;
}

/** Split flat training ops into per-sample runs (LOAD_X … next LOAD_X). */
export function splitIntoSampleRuns(
  instructions: CompiledInstruction[]
): CompiledInstruction[][] {
  const runs: CompiledInstruction[][] = [];
  let current: CompiledInstruction[] = [];
  for (const inst of instructions) {
    if (inst.op === "LOAD_X" && current.length > 0) {
      runs.push(current);
      current = [];
    }
    current.push(inst);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function buildBatchSteps(
  jobId: string,
  batch: CompiledInstruction[],
  store: TensorStore
): BatchStepCalldata[] {
  const externalIds = collectExternalTensorIds(batch);
  const available = new Set<string>(externalIds);
  return [
    ...externalIds.map((id) => seedStepFromTensor(store.require(jobId, id))),
    ...batch.map((inst) => {
      const step = packBatchStep(inst, available);
      available.add(inst.output);
      return step;
    }),
  ];
}

async function dispatchRawBatch(
  ctx: ShardDispatchContext,
  program: CompiledProgram,
  batchIndex: number,
  batch: CompiledInstruction[],
  store: TensorStore,
  hooks: FastDispatchHooks
): Promise<void> {
  const batchHash = hashInstructionBatch(batch);
  const steps = buildBatchSteps(program.jobId, batch, store);
  const { receipt, payloadHash, ipfsCid } = await sendBatchExecute(
    hooks.batchExecutor,
    program.jobId,
    batchIndex,
    batchHash,
    steps,
    { stats: hooks.stats, log: hooks.hydrateOptions?.log }
  );
  await hooks.onBatch?.(batchIndex, batch, batchHash, { payloadHash, ipfsCid });
  hooks.stats?.markBatchExecute();
  hooks.onTx(receipt.hash);
  await hydrateBatchReceipt(
    store,
    receipt,
    await hooks.batchExecutor.getAddress(),
    steps,
    ctx.deployment,
    ctx.signer,
    hooks.hydrateOptions
  );
  for (const inst of batch) hooks.applyAliases(inst);
  await hooks.onGasReceipt?.(batchIndex, receipt);
}

function maxAdamShardStepsPerTx(jobId: string, shardSize: number): number {
  let lo = 1;
  let hi = 16;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const steps: BatchStepCalldata[] = Array.from({ length: mid }, (_, i) => ({
      outTensorId: tensorId(`adam_shard_${i}`),
      opcode: Op.ADAM,
      inputTensorIds: [],
      inShape: [shardSize],
      literalData: Array(shardSize * 4).fill(1n),
      outShape: [shardSize * 4],
      params: [1n, 1n, 1n, 1n],
    }));
    const bytes = encodeBatchCalldataBytes(jobId, steps);
    if (bytes <= MAX_BATCH_CALLDATA_BYTES) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function maxDotStepsPerTx(jobId: string, rows: number): number {
  let lo = 1;
  let hi = 128;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const steps: BatchStepCalldata[] = Array.from({ length: mid }, (_, i) => ({
      outTensorId: tensorId(`dot_${i}`),
      opcode: Op.DOT,
      inputTensorIds: [],
      inShape: [rows],
      literalData: Array(rows * 2).fill(1n),
      outShape: [1],
      params: [],
    }));
    const bytes = encodeBatchCalldataBytes(jobId, steps);
    if (bytes <= MAX_BATCH_CALLDATA_BYTES) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Single core.execute when executeBatch tuple overhead exceeds the limit. */
async function dispatchSingleOpCoreFast(
  ctx: ShardDispatchContext,
  program: CompiledProgram,
  inst: CompiledInstruction,
  store: TensorStore,
  batchIndex: number,
  hooks: FastDispatchHooks
): Promise<void> {
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
  const batchHash = hashInstructionBatch([inst]);
  await hooks.onBatch?.(batchIndex, [inst], batchHash);
  const coreKey = CORE_KEY_BY_ID[coreForOpcode(inst.opcode)];
  const core = hooks.coreContract(coreKey);
  const receipt = await sendAndWaitContract(
    core,
    "execute",
    [
      program.jobId,
      batchIndex,
      batchHash,
      packed.outTensorId,
      inst.opcode,
      packed.inShape,
      packed.inData,
      packed.outShape,
      packed.params,
    ],
    { gasLimit: TX_GAS_LIMIT, stats: hooks.stats }
  );
  hooks.onTx(receipt.hash);
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
    hooks.hydrateOptions
  );
  hooks.applyAliases(inst);
  await hooks.onGasReceipt?.(batchIndex, receipt);
}

async function dispatchShardedAdamFast(
  ctx: ShardDispatchContext,
  program: CompiledProgram,
  inst: CompiledInstruction,
  store: TensorStore,
  batchIndex: number,
  hooks: FastDispatchHooks
): Promise<void> {
  const keys = ["grad", "W", "m", "v"].filter((k) => inst.inputs[k]);
  const tensors = keys.map((k) => store.require(program.jobId, inst.inputs[k]));
  const n = tensors[0].data.length;
  const shardSize = maxAdamShardElementsInBatch(program.jobId);
  const shardsPerTx = maxAdamShardStepsPerTx(program.jobId, shardSize);
  const wAcc = new Array<bigint>(n);
  const mAcc = new Array<bigint>(n);
  const vAcc = new Array<bigint>(n);

  let bi = batchIndex;
  for (let off = 0; off < n; ) {
    const steps: BatchStepCalldata[] = [];
    const shardOutIds: { off: number; len: number; id: string }[] = [];

    for (let s = 0; s < shardsPerTx && off < n; s++) {
      const len = Math.min(shardSize, n - off);
      const inData: bigint[] = [];
      for (const t of tensors) inData.push(...t.data.slice(off, off + len));
      const outId = tensorId(`${inst.output}_s${off}`);
      steps.push({
        outTensorId: outId,
        opcode: Op.ADAM,
        inputTensorIds: [],
        inShape: [len],
        literalData: inData,
        outShape: [len * 4],
        params: inst.params,
      });
      shardOutIds.push({ off, len, id: outId });
      off += len;
    }

    const batchHash = hashInstructionBatch([inst]);
    const { receipt, payloadHash, ipfsCid } = await sendBatchExecute(
      hooks.batchExecutor,
      program.jobId,
      bi,
      batchHash,
      steps,
      { stats: hooks.stats, log: hooks.hydrateOptions?.log }
    );
    await hooks.onBatch?.(bi, [inst], batchHash, { payloadHash, ipfsCid });
    hooks.stats?.markBatchExecute();
    hooks.onTx(receipt.hash);
    await hydrateBatchReceipt(
      store,
      receipt,
      await hooks.batchExecutor.getAddress(),
      steps,
      ctx.deployment,
      ctx.signer,
      hooks.hydrateOptions
    );

    for (const { off: o, len, id } of shardOutIds) {
      const shardOut = store.require(program.jobId, id).data;
      for (let i = 0; i < len; i++) {
        wAcc[o + i] = shardOut[i];
        mAcc[o + i] = shardOut[len + i];
        vAcc[o + i] = shardOut[2 * len + i];
      }
    }
    await hooks.onGasReceipt?.(bi, receipt);
    bi++;
  }

  store.put({
    jobId: program.jobId,
    tensorId: inst.output,
    shape: inst.outShape,
    data: [...wAcc, ...mAcc, ...vAcc, ...wAcc],
    hcsSeq: batchIndex,
    messageHash: hashInstructionBatch([inst]),
  });
  hooks.applyAliases(inst);
}

async function dispatchShardedSgdFast(
  ctx: ShardDispatchContext,
  program: CompiledProgram,
  inst: CompiledInstruction,
  store: TensorStore,
  batchIndex: number,
  hooks: FastDispatchHooks
): Promise<void> {
  const grad = store.require(
    program.jobId,
    inst.inputs.grad ?? inst.inputs[Object.keys(inst.inputs)[0]]
  );
  const weight = store.require(
    program.jobId,
    inst.inputs.W ?? inst.inputs[Object.keys(inst.inputs)[1]]
  );
  const n = grad.data.length;
  const shardSize = maxSgdShardElements(program.jobId);
  const wAcc = new Array<bigint>(n);
  let bi = batchIndex;

  for (let off = 0; off < n; off += shardSize) {
    const len = Math.min(shardSize, n - off);
    const outId = tensorId(`${inst.output}_s${off}`);
    const steps: BatchStepCalldata[] = [
      {
        outTensorId: outId,
        opcode: Op.SGD,
        inputTensorIds: [],
        inShape: [len],
        literalData: [
          ...grad.data.slice(off, off + len),
          ...weight.data.slice(off, off + len),
        ],
        outShape: [len],
        params: inst.params,
      },
    ];
    const batchHash = hashInstructionBatch([inst]);
    const { receipt, payloadHash, ipfsCid } = await sendBatchExecute(
      hooks.batchExecutor,
      program.jobId,
      bi,
      batchHash,
      steps,
      { stats: hooks.stats, log: hooks.hydrateOptions?.log }
    );
    await hooks.onBatch?.(bi, [inst], batchHash, { payloadHash, ipfsCid });
    hooks.stats?.markBatchExecute();
    hooks.onTx(receipt.hash);
    await hydrateBatchReceipt(
      store,
      receipt,
      await hooks.batchExecutor.getAddress(),
      steps,
      ctx.deployment,
      ctx.signer,
      hooks.hydrateOptions
    );
    const shardOut = store.require(program.jobId, outId).data;
    for (let i = 0; i < len; i++) wAcc[off + i] = shardOut[i];
    await hooks.onGasReceipt?.(bi, receipt);
    bi++;
  }

  store.put({
    jobId: program.jobId,
    tensorId: inst.output,
    shape: inst.outShape,
    data: wAcc,
    hcsSeq: batchIndex,
    messageHash: hashInstructionBatch([inst]),
  });
  hooks.applyAliases(inst);
}

async function dispatchShardedBackwardMatmulFast(
  ctx: ShardDispatchContext,
  program: CompiledProgram,
  transposeInst: CompiledInstruction,
  matmulInst: CompiledInstruction,
  store: TensorStore,
  batchIndex: number,
  hooks: FastDispatchHooks
): Promise<void> {
  const wKey =
    transposeInst.inputs.W ?? transposeInst.inputs[Object.keys(transposeInst.inputs)[0]];
  const dKey = matmulInst.inputs.d ?? matmulInst.inputs.x ?? matmulInst.inputs.a;
  const W = store.require(program.jobId, wKey);
  const d = store.require(program.jobId, dKey!);
  const rows = transposeInst.inShape[0];
  const cols = transposeInst.inShape[1];
  const dotsPerTx = maxDotStepsPerTx(program.jobId, rows);
  const dPrev = new Array<bigint>(cols).fill(0n);
  let bi = batchIndex;

  for (let j = 0; j < cols; j += dotsPerTx) {
    const steps: BatchStepCalldata[] = [];
    const mapping: { col: number; outId: string }[] = [];

    for (let k = 0; k < dotsPerTx && j + k < cols; k++) {
      const colIdx = j + k;
      const col = Array.from({ length: rows }, (_, i) => W.data[i * cols + colIdx]);
      const outId = tensorId(`${matmulInst.output}_c${colIdx}`);
      steps.push({
        outTensorId: outId,
        opcode: Op.DOT,
        inputTensorIds: [],
        inShape: [rows],
        literalData: [...col, ...d.data.slice(0, rows)],
        outShape: [1],
        params: [],
      });
      mapping.push({ col: colIdx, outId });
    }

    const batchHash = hashInstructionBatch([transposeInst, matmulInst]);
    const { receipt, payloadHash, ipfsCid } = await sendBatchExecute(
      hooks.batchExecutor,
      program.jobId,
      bi,
      batchHash,
      steps,
      { stats: hooks.stats, log: hooks.hydrateOptions?.log }
    );
    await hooks.onBatch?.(bi, [transposeInst, matmulInst], batchHash, {
      payloadHash,
      ipfsCid,
    });
    hooks.stats?.markBatchExecute();
    hooks.onTx(receipt.hash);
    await hydrateBatchReceipt(
      store,
      receipt,
      await hooks.batchExecutor.getAddress(),
      steps,
      ctx.deployment,
      ctx.signer,
      hooks.hydrateOptions
    );

    for (const { col, outId } of mapping) {
      dPrev[col] = store.require(program.jobId, outId).data[0];
    }
    await hooks.onGasReceipt?.(bi, receipt);
    bi++;
  }

  store.put({
    jobId: program.jobId,
    tensorId: matmulInst.output,
    shape: matmulInst.outShape,
    data: dPrev,
    hcsSeq: batchIndex,
    messageHash: hashInstructionBatch([matmulInst]),
  });
  hooks.applyAliases(transposeInst);
  hooks.applyAliases(matmulInst);
}

function countOptimizers(batch: CompiledInstruction[]): number {
  return batch.filter((i) => i.opcode === Op.ADAM || i.opcode === Op.SGD).length;
}

function optimizerInputsReady(
  jobId: string,
  inst: CompiledInstruction,
  store: TensorStore
): boolean {
  return Object.values(inst.inputs).every((id) => store.get(jobId, id) !== undefined);
}

function isTransposeMatmulPair(
  inst: CompiledInstruction,
  next?: CompiledInstruction
): boolean {
  return (
    inst.opcode === Op.TRANSPOSE &&
    next?.opcode === Op.MATMUL &&
    (next.inputs.d !== undefined || next.inputs.x !== undefined)
  );
}

/**
 * Greedy executeBatch segmentation: packs as many ops per TX as calldata allows.
 * Uses in-TX tensor cache (TRANSPOSE refs W instead of 64 separate DOT txs).
 */
export async function dispatchGreedyBatches(
  ctx: ShardDispatchContext,
  program: CompiledProgram,
  instructions: CompiledInstruction[],
  startBatchIndex: number,
  store: TensorStore,
  hooks: FastDispatchHooks
): Promise<number> {
  let bi = startBatchIndex;
  let i = 0;

  while (i < instructions.length) {
    const inst = instructions[i];
    const next = instructions[i + 1];

    if (
      isTransposeMatmulPair(inst, next) &&
      !batchFitsCalldataLimit(program.jobId, [inst, next], store)
    ) {
      await dispatchShardedBackwardMatmulFast(
        ctx,
        program,
        inst,
        next,
        store,
        bi,
        hooks
      );
      bi++;
      i += 2;
      continue;
    }

    if (
      inst.opcode === Op.ADAM &&
      optimizerInputsReady(program.jobId, inst, store) &&
      needsShardedAdam(program.jobId, inst, store)
    ) {
      await dispatchShardedAdamFast(ctx, program, inst, store, bi, hooks);
      bi++;
      i++;
      continue;
    }

    if (
      inst.opcode === Op.SGD &&
      optimizerInputsReady(program.jobId, inst, store) &&
      needsShardedSgd(program.jobId, inst, store)
    ) {
      await dispatchShardedSgdFast(ctx, program, inst, store, bi, hooks);
      bi++;
      i++;
      continue;
    }

    let end = i + 1;
    while (end < instructions.length) {
      const candidate = instructions.slice(i, end + 1);
      const tail = instructions[end];
      if (
        tail.opcode === Op.ADAM &&
        optimizerInputsReady(program.jobId, tail, store) &&
        needsShardedAdam(program.jobId, tail, store)
      ) {
        break;
      }
      if (
        isTransposeMatmulPair(tail, instructions[end + 1]) &&
        !batchFitsCalldataLimit(program.jobId, [tail, instructions[end + 1]], store)
      ) {
        break;
      }
      if (!batchFitsCalldataLimit(program.jobId, candidate, store)) break;
      if (countOptimizers(candidate) > 1) break;
      end++;
    }

    const segment = instructions.slice(i, end);
    if (!batchFitsCalldataLimit(program.jobId, segment, store)) {
      if (segment.length === 1) {
        await dispatchSingleOpCoreFast(ctx, program, segment[0], store, bi, hooks);
        bi++;
        i = end;
        continue;
      }
      throw new Error(
        `Greedy segment ${segment[0]?.op}..${segment[segment.length - 1]?.op} exceeds calldata`
      );
    }
    await dispatchRawBatch(ctx, program, bi, segment, store, hooks);
    bi++;
    i = end;
  }

  return bi;
}
