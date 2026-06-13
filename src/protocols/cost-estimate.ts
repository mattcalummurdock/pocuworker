import { getArchitectureById } from "../cpu/models/architectures";

const DEFAULT_BATCH_BUFFER = parseFloat(process.env.MPP_GAS_BUFFER_HBAR ?? "15");
const DEFAULT_JOB_BUFFER = parseFloat(process.env.JOB_COST_BUFFER_HBAR ?? "10");
export const ALLOWANCE_CAP_HBAR = parseFloat(process.env.ALLOWANCE_HBAR ?? "200");

export function estimateBatchCount(
  architectureId: string,
  samples: number,
  epochs: number
): number {
  const arch = getArchitectureById(architectureId);
  const layers = arch.layers?.length ?? 2;
  const opsPerSample = 4 + layers * 6;
  const totalOps = Math.max(1, samples * epochs * opsPerSample);
  return Math.max(1, Math.ceil(totalOps / 4));
}

export function estimateJobCostHbar(
  architectureId: string,
  samples: number,
  epochs: number
): number {
  const batches = estimateBatchCount(architectureId, samples, epochs);
  return batches * DEFAULT_BATCH_BUFFER + DEFAULT_JOB_BUFFER;
}

export function exceedsAllowanceCap(
  architectureId: string,
  samples: number,
  epochs: number
): boolean {
  return estimateJobCostHbar(architectureId, samples, epochs) > ALLOWANCE_CAP_HBAR;
}
