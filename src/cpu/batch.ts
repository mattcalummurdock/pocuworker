import { keccak256 } from "ethers";
import { CompiledInstruction } from "./types";
import { collectExternalTensorIds, packBatchStep, seedStepFromTensor } from "./postman";
import { TensorStore } from "./tensor-store";
import { encodeBatchCalldataBytes, SAFE_CALLDATA_LIMIT } from "./calldata";
import {
  encodeBatchPackedCalldataBytes,
  hashPackedPayload,
  packBatchSteps,
  usePackedBatch,
} from "./packed-batch";
import { Op } from "./isa";

function tensorElementCount(inst: CompiledInstruction): number {
  if (inst.literal) return inst.literal.data.length;
  return inst.outShape.reduce((a, b) => a * b, 1);
}

/** Size-only seed for calldata estimation when tensor is not in store yet. */
function seedEstimateStep(
  tensorId: string,
  batch: CompiledInstruction[]
): ReturnType<typeof seedStepFromTensor> {
  const producer = batch.find((i) => i.output === tensorId);
  const len = producer ? tensorElementCount(producer) : 64;
  return {
    outTensorId: tensorId,
    opcode: Op.FLATTEN,
    inputTensorIds: [],
    inShape: [len],
    literalData: Array(len).fill(0n),
    outShape: producer?.outShape ?? [len],
    params: [],
  };
}

/** Hedera EVM call data limit is 128KB; leave headroom for ABI encoding. */
export const MAX_BATCH_CALLDATA_BYTES = SAFE_CALLDATA_LIMIT;

/** Split program into TX batches: init block + groups of training samples. */
export function groupInstructionBatches(
  instructions: CompiledInstruction[],
  samplesPerTx: number
): CompiledInstruction[][] {
  const sampleRuns: CompiledInstruction[][] = [];
  let current: CompiledInstruction[] = [];

  for (const inst of instructions) {
    if (inst.op === "LOAD_X" && current.length > 0) {
      sampleRuns.push(current);
      current = [];
    }
    current.push(inst);
  }
  if (current.length > 0) sampleRuns.push(current);

  if (sampleRuns.length === 0) return [];

  const isInitBatch = sampleRuns[0][0]?.op.startsWith("INIT");
  const initBatch = isInitBatch ? sampleRuns.shift()! : null;
  const merged: CompiledInstruction[][] = initBatch ? splitInitBatch(initBatch) : [];

  const perTx = Math.max(1, samplesPerTx);
  for (let i = 0; i < sampleRuns.length; i += perTx) {
    const chunk = sampleRuns.slice(i, i + perTx).flat();
    if (chunk.length > 0) merged.push(chunk);
  }

  return merged;
}

export function hashInstructionBatch(batch: CompiledInstruction[]): string {
  return keccak256(
    new TextEncoder().encode(
      JSON.stringify(
        batch.map((i) => ({
          seq: i.seq,
          op: i.op,
          opcode: i.opcode,
          output: i.output,
        }))
      )
    )
  );
}

function splitInitBatch(initBatch: CompiledInstruction[]): CompiledInstruction[][] {
  const out: CompiledInstruction[][] = [];
  let small: CompiledInstruction[] = [];
  for (const inst of initBatch) {
    const n = inst.literal?.data.length ?? 0;
    if (n > 64) {
      if (small.length) {
        out.push(small);
        small = [];
      }
      out.push([inst]);
    } else {
      small.push(inst);
      if (small.length >= 6) {
        out.push(small);
        small = [];
      }
    }
  }
  if (small.length) out.push(small);
  return out;
}

/** ABI-encoded executeBatch calldata size (bytes). */
export function estimateBatchCalldataBytes(
  jobId: string,
  batch: CompiledInstruction[],
  store: TensorStore
): number {
  if (batch.length === 0) return 0;
  const externalIds = collectExternalTensorIds(batch);
  const available = new Set<string>(externalIds);
  const steps = [
    ...externalIds.map((id) => {
      const t = store.get(jobId, id);
      return t ? seedStepFromTensor(t) : seedEstimateStep(id, batch);
    }),
    ...batch.map((inst) => {
      const step = packBatchStep(inst, available);
      available.add(inst.output);
      return step;
    }),
  ];
  try {
    if (usePackedBatch()) {
      const packed = packBatchSteps(steps);
      const payloadHash = hashPackedPayload(packed);
      return encodeBatchPackedCalldataBytes(jobId, 0, "0x" + "00".repeat(32), payloadHash, packed);
    }
    return encodeBatchCalldataBytes(jobId, steps);
  } catch {
    let bytes = 0;
    for (const id of externalIds) {
      const t = store.get(jobId, id);
      if (t) bytes += t.data.length * 32;
    }
    for (const inst of batch) {
      if (inst.literal) bytes += inst.literal.data.length * 32;
    }
    return Math.ceil(bytes * 2.2) + 4096;
  }
}

export function batchFitsCalldataLimit(
  jobId: string,
  batch: CompiledInstruction[],
  store: TensorStore,
  limit = MAX_BATCH_CALLDATA_BYTES
): boolean {
  return estimateBatchCalldataBytes(jobId, batch, store) <= limit;
}

export function resolveSamplesPerTx(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(env.SAMPLES_PER_TX ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 32);
}

export function resolveDispatchMode(env: NodeJS.ProcessEnv = process.env): "batch" | "single" {
  const mode = (env.CPU_DISPATCH_MODE ?? "batch").toLowerCase();
  return mode === "single" ? "single" : "batch";
}
