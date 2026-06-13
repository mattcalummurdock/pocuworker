import { Contract, ContractTransactionReceipt } from "ethers";
import { BatchStepCalldata, batchStepsToAbi } from "./postman";
import {
  encodeBatchPackedCalldataBytes,
  hashPackedPayload,
  packBatchSteps,
  shouldPinBatchPayload,
  usePackedBatch,
} from "./packed-batch";
import { pinBatchPayload } from "../ipfs/pinata";
import { encodeBatchCalldataBytes } from "./calldata";
import { sendAndWaitContract, SendContractOptions } from "../tx-utils";
import { TX_GAS_LIMIT } from "../config";
import { StepLogger } from "../logger";

export interface BatchSendResult {
  receipt: ContractTransactionReceipt;
  payloadHash?: string;
  ipfsCid?: string;
  packed: boolean;
}

export async function sendBatchExecute(
  executor: Contract,
  jobId: string,
  batchIndex: number,
  batchHash: string,
  steps: BatchStepCalldata[],
  options?: SendContractOptions & { log?: StepLogger }
): Promise<BatchSendResult> {
  const gasOpts = { gasLimit: TX_GAS_LIMIT, ...options };

  if (usePackedBatch()) {
    const packed = packBatchSteps(steps);
    const payloadHash = hashPackedPayload(packed);
    let ipfsCid: string | undefined;
    if (shouldPinBatchPayload()) {
      ipfsCid = await pinBatchPayload(packed, {
        jobId,
        batchIndex,
        batchHash,
        payloadHash,
      });
      options?.log?.info(
        `Batch payload IPFS cid=${ipfsCid.replace(/^ipfs:\/\//, "")} (${packed.length} bytes, ${steps.length} steps)`
      );
    }
    const receipt = await sendAndWaitContract(
      executor,
      "executeBatchPacked",
      [jobId, batchIndex, batchHash, payloadHash, packed],
      {
        ...gasOpts,
        txLabel: `executeBatchPacked#${batchIndex} (${packed.length}B)`,
      }
    );
    return { receipt, payloadHash, ipfsCid, packed: true };
  }

  const receipt = await sendAndWaitContract(
    executor,
    "executeBatch",
    [jobId, batchIndex, batchHash, batchStepsToAbi(steps)],
    gasOpts
  );
  return { receipt, packed: false };
}

export function batchCalldataBytes(
  jobId: string,
  batchIndex: number,
  batchHash: string,
  steps: BatchStepCalldata[]
): number {
  if (usePackedBatch()) {
    const packed = packBatchSteps(steps);
    const payloadHash = hashPackedPayload(packed);
    return encodeBatchPackedCalldataBytes(jobId, batchIndex, batchHash, payloadHash, packed);
  }
  return encodeBatchCalldataBytes(jobId, steps);
}
