import { OpCode } from "./isa";
import { TensorStore } from "./tensor-store";

export interface TensorRecord {
  jobId: string;
  tensorId: string;
  shape: number[];
  data: bigint[];
  hcsSeq: number;
  messageHash: string;
  /** Phase B: keccak256(abi.encode(data)) from TensorCommitted. */
  dataHash?: string;
  /** Pinata IPFS URI for off-chain tensor bytes. */
  ipfsUri?: string;
  chunkIndex?: number;
  chunkCount?: number;
}

export interface CompiledInstruction {
  seq: number;
  op: string;
  opcode: OpCode;
  inputs: Record<string, string>;
  output: string;
  inShape: number[];
  outShape: number[];
  params: bigint[];
  literal?: { shape: number[]; data: bigint[] };
}

export interface CompiledProgram {
  jobId: string;
  dataHash: string;
  architecture: string;
  instructions: CompiledInstruction[];
  weightTensorIds: string[];
  epochs: number;
  batchSize: number;
}

export interface DispatchResult {
  txHashes: string[];
  programHash: string;
  eventLogHash: string;
  finalWeights: Map<string, TensorRecord>;
  store: TensorStore;
}
