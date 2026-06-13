import { Contract, ContractTransactionReceipt, Interface } from "ethers";
import { CORE_KEY_BY_ID, coreForOpcode } from "./isa";
import { BatchStepCalldata } from "./postman";
import { TensorStore } from "./tensor-store";
import { TensorRecord } from "./types";
import { hashTensorData } from "./tensor-hash";
import {
  cidFromIpfsUri,
  pinTensorJson,
  shouldPinDuringHydrate,
} from "../ipfs/pinata";
import { DeploymentAddresses } from "../types";
import { StepLogger } from "../logger";

const COMMITTED_ABI = [
  "event TensorCommitted(bytes32 indexed jobId, bytes32 indexed tensorId, uint64 hcsSeq, bytes32 messageHash, uint16[] shape, bytes32 dataHash)",
];

export interface CommittedEvent {
  jobId: string;
  tensorId: string;
  hcsSeq: number;
  messageHash: string;
  shape: number[];
  dataHash: string;
}

const iface = new Interface(COMMITTED_ABI);

export function parseCommittedEvents(
  receipt: ContractTransactionReceipt,
  contractAddress: string
): CommittedEvent[] {
  const out: CommittedEvent[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "TensorCommitted") continue;
      out.push({
        jobId: parsed.args.jobId as string,
        tensorId: parsed.args.tensorId as string,
        hcsSeq: Number(parsed.args.hcsSeq),
        messageHash: parsed.args.messageHash as string,
        shape: (parsed.args.shape as bigint[]).map(Number),
        dataHash: parsed.args.dataHash as string,
      });
    } catch {
      // skip unrelated logs
    }
  }
  return out;
}

function resolveInputs(
  cache: Map<string, bigint[]>,
  inputTensorIds: string[],
  literalData: bigint[]
): bigint[] {
  if (inputTensorIds.length === 0) return literalData;
  if (literalData.length > 0) return literalData;
  const parts: bigint[] = [];
  for (const id of inputTensorIds) {
    const d = cache.get(id);
    if (!d) throw new Error(`Tensor not in batch cache: ${id}`);
    parts.push(...d);
  }
  return parts;
}

const SIM_ABI = [
  "function simulateOpcode(uint8 opcode, uint16[] inShape, int256[] inData, uint16[] outShape, int256[] params) view returns (int256[])",
];

export async function simulateBatchSteps(
  steps: BatchStepCalldata[],
  cores: DeploymentAddresses["cores"],
  signer: { provider: unknown }
): Promise<{ shape: number[]; data: bigint[] }[]> {
  const cache = new Map<string, bigint[]>();
  const outputs: { shape: number[]; data: bigint[] }[] = [];

  for (const step of steps) {
    const inData = resolveInputs(cache, step.inputTensorIds, step.literalData);
    const coreKey = CORE_KEY_BY_ID[coreForOpcode(step.opcode)];
    const addr = cores[coreKey];
    const core = new Contract(addr, SIM_ABI, signer as never);
    const raw: bigint[] = await core.simulateOpcode.staticCall(
      step.opcode,
      step.inShape,
      inData,
      step.outShape,
      step.params
    );
    const data = raw.map((d) => BigInt(d));
    cache.set(step.outTensorId, data);
    outputs.push({ shape: [...step.outShape], data });
  }

  return outputs;
}

export async function simulateSingleOpcode(
  coreAddress: string,
  opcode: number,
  inShape: number[],
  inData: bigint[],
  outShape: number[],
  params: bigint[],
  signer: { provider: unknown }
): Promise<bigint[]> {
  const core = new Contract(coreAddress, SIM_ABI, signer as never);
  const raw: bigint[] = await core.simulateOpcode.staticCall(
    opcode,
    inShape,
    inData,
    outShape,
    params
  );
  return raw.map((d) => BigInt(d));
}

export interface HydrateOptions {
  pinIpfs?: boolean;
  log?: StepLogger;
}

function logIpfsCid(
  options: HydrateOptions | undefined,
  tensorId: string,
  uri: string,
  shape: number[]
): void {
  const cid = cidFromIpfsUri(uri);
  if (options?.log) {
    options.log.logIpfsPin(cid, tensorId, shape);
    return;
  }
  console.log(`IPFS cid=${cid} tensor=${tensorId.slice(0, 14)}…`);
}

/** Verify on-chain hashes via core.simulateOpcode, fill store, optionally pin to IPFS. */
export async function hydrateBatchReceipt(
  store: TensorStore,
  receipt: ContractTransactionReceipt,
  executorAddress: string,
  steps: BatchStepCalldata[],
  deployment: DeploymentAddresses,
  signer: { provider: unknown },
  options?: HydrateOptions
): Promise<TensorRecord[]> {
  const events = parseCommittedEvents(receipt, executorAddress);
  if (events.length !== steps.length) {
    throw new Error(
      `TensorCommitted count (${events.length}) != batch steps (${steps.length})`
    );
  }
  const simulated = await simulateBatchSteps(steps, deployment.cores, signer);
  const pin = options?.pinIpfs ?? shouldPinDuringHydrate();
  const ingested: TensorRecord[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const step = steps[i];
    if (ev.tensorId !== step.outTensorId) {
      throw new Error(
        `Event/step tensor mismatch at ${i}: ${ev.tensorId} vs ${step.outTensorId}`
      );
    }
    const out = simulated[i];
    if (!out) throw new Error(`No simulated output for step ${i}`);
    const hash = hashTensorData(out.data);
    if (hash !== ev.dataHash) {
      throw new Error(
        `On-chain hash mismatch for ${ev.tensorId}: expected ${ev.dataHash}, got ${hash}`
      );
    }
    let ipfsUri: string | undefined;
    if (pin) {
      ipfsUri = await pinTensorJson(ev.jobId, ev.tensorId, out.shape, out.data);
      logIpfsCid(options, ev.tensorId, ipfsUri, out.shape);
    }
    const record: TensorRecord = {
      jobId: ev.jobId,
      tensorId: ev.tensorId,
      shape: out.shape,
      data: out.data,
      hcsSeq: ev.hcsSeq,
      messageHash: ev.messageHash,
      dataHash: ev.dataHash,
      ipfsUri,
    };
    store.put(record);
    ingested.push(record);
  }

  return ingested;
}

export async function hydrateSingleReceipt(
  store: TensorStore,
  receipt: ContractTransactionReceipt,
  coreAddress: string,
  opcode: number,
  inShape: number[],
  inData: bigint[],
  outShape: number[],
  params: bigint[],
  outTensorId: string,
  signer: { provider: unknown },
  options?: HydrateOptions
): Promise<TensorRecord | undefined> {
  const events = parseCommittedEvents(receipt, coreAddress);
  const ev = events.find((e) => e.tensorId === outTensorId) ?? events[0];
  if (!ev) return undefined;

  const data = await simulateSingleOpcode(
    coreAddress,
    opcode,
    inShape,
    inData,
    outShape,
    params,
    signer
  );
  const hash = hashTensorData(data);
  if (hash !== ev.dataHash) {
    throw new Error(`On-chain hash mismatch for ${outTensorId}`);
  }

  const pin = options?.pinIpfs ?? shouldPinDuringHydrate();
  let ipfsUri: string | undefined;
  if (pin) {
    ipfsUri = await pinTensorJson(ev.jobId, ev.tensorId, outShape, data);
    logIpfsCid(options, ev.tensorId, ipfsUri, outShape);
  }

  const record: TensorRecord = {
    jobId: ev.jobId,
    tensorId: ev.tensorId,
    shape: outShape,
    data,
    hcsSeq: ev.hcsSeq,
    messageHash: ev.messageHash,
    dataHash: ev.dataHash,
    ipfsUri,
  };
  store.put(record);
  return record;
}
