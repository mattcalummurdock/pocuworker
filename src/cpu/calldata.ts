import { Interface, ZeroHash } from "ethers";
import { CPU_LIMITS, Op } from "./isa";

export const HEDERA_CALLDATA_LIMIT = 131_072;
/** Leave headroom for RPC / ABI dynamic encoding. */
export const SAFE_CALLDATA_LIMIT = 120_000;

const EXECUTE_ABI =
  "function execute(bytes32,uint64,bytes32,bytes32,uint8,uint16[],int256[],uint16[],int256[])";

const BATCH_ABI =
  "function executeBatch(bytes32,uint64,bytes32,tuple(bytes32,uint8,bytes32[],uint16[],int256[],uint16[],int256[])[])";

const executeIface = new Interface([EXECUTE_ABI]);
const batchIface = new Interface([BATCH_ABI]);

export function encodeExecuteCalldataBytes(
  jobId: string,
  opcode: number,
  inShape: number[],
  inData: bigint[],
  outShape: number[],
  params: bigint[],
  outTensorId = ZeroHash
): number {
  const data = executeIface.encodeFunctionData("execute", [
    jobId,
    1n,
    ZeroHash,
    outTensorId,
    opcode,
    inShape,
    inData,
    outShape,
    params,
  ]);
  return (data.length - 2) / 2;
}

export function instructionFitsCalldataLimit(
  jobId: string,
  opcode: number,
  inShape: number[],
  inData: bigint[],
  outShape: number[],
  params: bigint[],
  limit = SAFE_CALLDATA_LIMIT
): boolean {
  return (
    encodeExecuteCalldataBytes(jobId, opcode, inShape, inData, outShape, params) <= limit
  );
}

function binarySearchMaxElements(
  jobId: string,
  opcode: number,
  elementCount: (n: number) => number,
  outShape: (n: number) => number[],
  params: bigint[],
  limit: number
): number {
  let lo = 1;
  let hi = 4096;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const n = elementCount(mid);
    const inData = Array(n).fill(1n);
    const bytes = encodeExecuteCalldataBytes(
      jobId,
      opcode,
      [mid],
      inData,
      outShape(mid),
      params
    );
    if (bytes <= limit) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const MAX_ADAM_SHARD_ONCHAIN = Math.floor(CPU_LIMITS.maxTensorElements / 4);

export function maxAdamShardElements(
  jobId: string,
  limit = SAFE_CALLDATA_LIMIT
): number {
  const byCalldata = binarySearchMaxElements(
    jobId,
    Op.ADAM,
    (n) => n * 4,
    (n) => [n * 4],
    [1n, 1n, 1n, 1n],
    limit
  );
  return Math.min(byCalldata, MAX_ADAM_SHARD_ONCHAIN);
}

/** Max ADAM shard width when the step is inside executeBatch (larger ABI overhead). */
export function maxAdamShardElementsInBatch(
  jobId: string,
  limit = SAFE_CALLDATA_LIMIT
): number {
  let lo = 1;
  let hi = Math.min(maxAdamShardElements(jobId, limit), MAX_ADAM_SHARD_ONCHAIN);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const steps = [
      {
        outTensorId:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        opcode: Op.ADAM,
        inputTensorIds: [] as string[],
        inShape: [mid],
        literalData: Array(mid * 4).fill(1n),
        outShape: [mid * 4],
        params: [1n, 1n, 1n, 1n],
      },
    ];
    const bytes = encodeBatchCalldataBytes(jobId, steps);
    if (bytes <= limit) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function maxSgdShardElements(
  jobId: string,
  limit = SAFE_CALLDATA_LIMIT
): number {
  return binarySearchMaxElements(
    jobId,
    Op.SGD,
    (n) => n * 2,
    (n) => [n],
    [1n],
    limit
  );
}

export function maxUnaryTensorElements(
  jobId: string,
  opcode: number,
  limit = SAFE_CALLDATA_LIMIT
): number {
  return binarySearchMaxElements(jobId, opcode, (n) => n, (n) => [n], [], limit);
}

export function encodeBatchCalldataBytes(
  jobId: string,
  steps: {
    outTensorId: string;
    opcode: number;
    inputTensorIds: string[];
    inShape: number[];
    literalData: bigint[];
    outShape: number[];
    params: bigint[];
  }[]
): number {
  const tuples = steps.map((s) => [
    s.outTensorId,
    s.opcode,
    s.inputTensorIds,
    s.inShape,
    s.literalData,
    s.outShape,
    s.params,
  ]);
  const data = batchIface.encodeFunctionData("executeBatch", [
    jobId,
    0n,
    ZeroHash,
    tuples,
  ]);
  return (data.length - 2) / 2;
}
