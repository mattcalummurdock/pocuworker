/**
 * On-chain CPU instruction set — mirrors contracts/libraries/CpuOpCodes.sol
 * @see docs/cpuarc.md Layer 2 & 3
 */

export const CPU_LIMITS = {
  maxMatDim: 64,
  /** Adam bundles 4× weights; 64×64 mat → 16384 elements. */
  maxTensorElements: 16384,
  maxBatch: 32,
  maxProgramInstructions: 10_000,
  maxTreeDepth: 6,
} as const;

export const CoreId = {
  LinearAlgebra: 1,
  Activation: 2,
  Gradient: 3,
  Optimizer: 4,
  Aggregation: 5,
} as const;

export const Op = {
  // CoreA
  MATMUL: 1,
  ADD: 2,
  SUB: 3,
  MUL_SCALAR: 4,
  DOT: 5,
  OUTER: 6,
  TRANSPOSE: 7,
  CONV2D: 8,
  FLATTEN: 9,
  // CoreB
  RELU: 16,
  SIGMOID: 17,
  SOFTMAX: 18,
  TANH: 19,
  GELU: 20,
  DROPOUT_MASK: 21,
  // CoreC
  CROSS_ENTROPY: 32,
  MSE: 33,
  BACKWARD_SOFTMAX: 34,
  BACKWARD_MATMUL: 35,
  BACKWARD_RELU: 36,
  BACKWARD_SIGMOID: 37,
  BACKWARD_TANH: 38,
  BACKWARD_GELU: 39,
  // CoreD
  SGD: 48,
  ADAM: 49,
  RMSPROP: 50,
  LR_FROM_TIMESTAMP: 51,
  // CoreE
  REDUCE_SUM: 64,
  REDUCE_MEAN: 65,
  MAXPOOL: 66,
  LAYERNORM: 67,
  HISTOGRAM: 68,
  SPLIT_GAIN: 69,
  LEAF_AGGREGATE: 70,
} as const;

export type OpCode = (typeof Op)[keyof typeof Op];

export const OP_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(Op).map(([k, v]) => [v, k])
);

export function coreForOpcode(opcode: number): number {
  if (opcode >= 1 && opcode <= 9) return CoreId.LinearAlgebra;
  if (opcode >= 16 && opcode <= 21) return CoreId.Activation;
  if (opcode >= 32 && opcode <= 39) return CoreId.Gradient;
  if (opcode >= 48 && opcode <= 51) return CoreId.Optimizer;
  if (opcode >= 64 && opcode <= 70) return CoreId.Aggregation;
  throw new Error(`Unknown opcode: ${opcode}`);
}

export type CoreName = "linear" | "activation" | "gradient" | "optimizer" | "aggregation";

export const CORE_KEY_BY_ID: Record<number, CoreName> = {
  [CoreId.LinearAlgebra]: "linear",
  [CoreId.Activation]: "activation",
  [CoreId.Gradient]: "gradient",
  [CoreId.Optimizer]: "optimizer",
  [CoreId.Aggregation]: "aggregation",
};

export interface TensorRef {
  id: string;
}

export interface CpuInstruction {
  op: string;
  opcode: OpCode;
  jobId: string;
  seq: number;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  params: Record<string, number | string>;
  inShape?: number[];
  outShape?: number[];
}

export type HcsMessageType =
  | "PROGRAM_START"
  | "INSTRUCTION"
  | "BATCH_EXECUTE"
  | "PROGRAM_END"
  | "COMMIT_WEIGHTS";

export interface HcsCpuMessage {
  type: HcsMessageType;
  job_id: string;
  seq?: number;
  op?: string;
  opcode?: number;
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  params?: Record<string, number | string>;
  data_hash?: string;
  event_log_hash?: string;
}
