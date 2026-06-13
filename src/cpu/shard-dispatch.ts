import { Contract, ContractTransactionReceipt } from "ethers";
import { CPU_LIMITS, Op } from "./isa";
import {
  instructionFitsCalldataLimit,
  maxAdamShardElements,
  maxSgdShardElements,
  maxUnaryTensorElements,
} from "./calldata";
import { packInstructionCalldata } from "./postman";
import { CompiledInstruction, CompiledProgram } from "./types";
import { TensorStore } from "./tensor-store";
import { DeploymentAddresses } from "../types";
import { Signer } from "ethers";
import { StepLogger } from "../logger";

export interface ShardDispatchContext {
  deployment: DeploymentAddresses;
  signer: Signer;
  topicId: string;
  log?: StepLogger;
}
import { TX_GAS_LIMIT } from "../config";
import { sendAndWaitContract } from "../tx-utils";
import { hydrateSingleReceipt } from "./hydrate";

type Packed = ReturnType<typeof packInstructionCalldata>;

function coreContract(ctx: ShardDispatchContext, coreKey: string): Contract {
  const addr = ctx.deployment.cores[coreKey as keyof typeof ctx.deployment.cores];
  const abi = [
    "function execute(bytes32 jobId, uint64 hcsSeq, bytes32 messageHash, bytes32 outTensorId, uint8 opcode, uint16[] inShape, int256[] inData, uint16[] outShape, int256[] params)",
  ];
  return new Contract(addr, abi, ctx.signer);
}

async function runPackedExecute(
  ctx: ShardDispatchContext,
  program: CompiledProgram,
  inst: CompiledInstruction,
  packed: Packed,
  coreKey: string,
  store: TensorStore,
  hcsSeq: number,
  messageHash: string
): Promise<ContractTransactionReceipt> {
  const core = coreContract(ctx, coreKey);
  const receipt = await sendAndWaitContract(
    core,
    "execute",
    [
      program.jobId,
      hcsSeq,
      messageHash,
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
    ctx.signer
  );
  return receipt;
}

export async function dispatchShardedAdam(
  ctx: ShardDispatchContext,
  program: CompiledProgram,
  inst: CompiledInstruction,
  store: TensorStore,
  coreKey: string,
  hcsSeq: number,
  messageHash: string
): Promise<ContractTransactionReceipt> {
  const keys = ["grad", "W", "m", "v"].filter((k) => inst.inputs[k]);
  const tensors = keys.map((k) => store.require(program.jobId, inst.inputs[k]));
  const n = tensors[0].data.length;
  const shardSize = maxAdamShardElements(program.jobId);
  const wAcc = new Array<bigint>(n);
  const mAcc = new Array<bigint>(n);
  const vAcc = new Array<bigint>(n);

  let lastReceipt: ContractTransactionReceipt | undefined;
  for (let off = 0; off < n; off += shardSize) {
    const len = Math.min(shardSize, n - off);
    const inData: bigint[] = [];
    for (const t of tensors) inData.push(...t.data.slice(off, off + len));
    const packed: Packed = {
      outTensorId: inst.output,
      inShape: [len],
      inData,
      outShape: [len * 4],
      params: inst.params,
    };
    lastReceipt = await runPackedExecute(
      ctx,
      program,
      inst,
      packed,
      coreKey,
      store,
      hcsSeq,
      messageHash
    );
    const shardOut = store.require(program.jobId, inst.output).data;
    for (let i = 0; i < len; i++) {
      wAcc[off + i] = shardOut[i];
      mAcc[off + i] = shardOut[len + i];
      vAcc[off + i] = shardOut[2 * len + i];
    }
  }

  store.put({
    jobId: program.jobId,
    tensorId: inst.output,
    shape: inst.outShape,
    data: [...wAcc, ...mAcc, ...vAcc, ...wAcc],
    hcsSeq,
    messageHash,
  });

  if (!lastReceipt) throw new Error("ADAM shard produced no receipt");
  return lastReceipt;
}

export async function dispatchShardedSgd(
  ctx: ShardDispatchContext,
  program: CompiledProgram,
  inst: CompiledInstruction,
  store: TensorStore,
  coreKey: string,
  hcsSeq: number,
  messageHash: string
): Promise<ContractTransactionReceipt> {
  const grad = store.require(program.jobId, inst.inputs.grad ?? inst.inputs[Object.keys(inst.inputs)[0]]);
  const weight = store.require(program.jobId, inst.inputs.W ?? inst.inputs[Object.keys(inst.inputs)[1]]);
  const n = grad.data.length;
  const shardSize = maxSgdShardElements(program.jobId);
  const wAcc = new Array<bigint>(n);

  let lastReceipt: ContractTransactionReceipt | undefined;
  for (let off = 0; off < n; off += shardSize) {
    const len = Math.min(shardSize, n - off);
    const packed: Packed = {
      outTensorId: inst.output,
      inShape: [len],
      inData: [...grad.data.slice(off, off + len), ...weight.data.slice(off, off + len)],
      outShape: [len],
      params: inst.params,
    };
    lastReceipt = await runPackedExecute(
      ctx,
      program,
      inst,
      packed,
      coreKey,
      store,
      hcsSeq,
      messageHash
    );
    const shardOut = store.require(program.jobId, inst.output).data;
    for (let i = 0; i < len; i++) wAcc[off + i] = shardOut[i];
  }

  store.put({
    jobId: program.jobId,
    tensorId: inst.output,
    shape: inst.outShape,
    data: wAcc,
    hcsSeq,
    messageHash,
  });

  if (!lastReceipt) throw new Error("SGD shard produced no receipt");
  return lastReceipt;
}

/**
 * W (rows×cols) · d (rows) → dPrev (cols) without materializing W^T in calldata.
 * Replaces TRANSPOSE + MATMUL when the transpose payload exceeds Hedera limits.
 */
export async function dispatchShardedBackwardMatmul(
  ctx: ShardDispatchContext,
  program: CompiledProgram,
  transposeInst: CompiledInstruction,
  matmulInst: CompiledInstruction,
  store: TensorStore,
  coreKey: string,
  hcsSeq: number,
  messageHash: string
): Promise<ContractTransactionReceipt> {
  const wKey = transposeInst.inputs.W ?? transposeInst.inputs[Object.keys(transposeInst.inputs)[0]];
  const dKey = matmulInst.inputs.d ?? matmulInst.inputs.x ?? matmulInst.inputs.a;
  const W = store.require(program.jobId, wKey);
  const d = store.require(program.jobId, dKey);
  const rows = transposeInst.inShape[0];
  const cols = transposeInst.inShape[1];
  const dPrev = new Array<bigint>(cols).fill(0n);

  let lastReceipt: ContractTransactionReceipt | undefined;
  for (let j = 0; j < cols; j++) {
    const col = Array.from({ length: rows }, (_, i) => W.data[i * cols + j]);
    const dotInst: CompiledInstruction = { ...matmulInst, opcode: Op.DOT };
    const packed: Packed = {
      outTensorId: matmulInst.output,
      inShape: [rows],
      inData: [...col, ...d.data.slice(0, rows)],
      outShape: [1],
      params: [],
    };
    lastReceipt = await runPackedExecute(
      ctx,
      program,
      dotInst,
      packed,
      coreKey,
      store,
      hcsSeq,
      messageHash
    );
    dPrev[j] = store.require(program.jobId, matmulInst.output).data[0];
  }

  store.put({
    jobId: program.jobId,
    tensorId: matmulInst.output,
    shape: matmulInst.outShape,
    data: dPrev,
    hcsSeq,
    messageHash,
  });

  if (!lastReceipt) throw new Error("Sharded backward matmul produced no receipt");
  return lastReceipt;
}

function tensorElementCount(shape: number[]): number {
  return shape.reduce((a, b) => a * b, 1);
}

export function needsShardedAdam(
  jobId: string,
  inst: CompiledInstruction,
  store: TensorStore
): boolean {
  const packed = packInstructionCalldata(jobId, inst, store);
  if (tensorElementCount(packed.outShape) > CPU_LIMITS.maxTensorElements) {
    return true;
  }
  return !instructionFitsCalldataLimit(
    jobId,
    inst.opcode,
    packed.inShape,
    packed.inData,
    packed.outShape,
    packed.params
  );
}

export function needsShardedSgd(
  jobId: string,
  inst: CompiledInstruction,
  store: TensorStore
): boolean {
  return needsShardedAdam(jobId, inst, store);
}

export function needsShardedTranspose(
  jobId: string,
  inst: CompiledInstruction,
  store: TensorStore
): boolean {
  const packed = packInstructionCalldata(jobId, inst, store);
  const n = packed.inData.length;
  const maxUnary = maxUnaryTensorElements(jobId, inst.opcode);
  return (
    n > maxUnary ||
    !instructionFitsCalldataLimit(
      jobId,
      inst.opcode,
      packed.inShape,
      packed.inData,
      packed.outShape,
      packed.params
    )
  );
}

export function isTransposeMatmulPair(
  inst: CompiledInstruction,
  next?: CompiledInstruction
): boolean {
  return (
    inst.opcode === Op.TRANSPOSE &&
    next?.opcode === Op.MATMUL &&
    (next.inputs.d !== undefined || next.inputs.x !== undefined)
  );
}
