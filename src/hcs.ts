import { TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { keccak256, toUtf8Bytes } from "ethers";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { StepLogger } from "./logger";
import { HcsCpuMessage } from "./cpu/isa";
import { getHederaSdkClient } from "./hedera-client";

export type HcsMessageType =
  | "PROGRAM_START"
  | "INSTRUCTION"
  | "BATCH_EXECUTE"
  | "PROGRAM_END"
  | "COMMIT_WEIGHTS"
  | "ACP_ORDER"
  | "ACP_STATUS";

export interface HcsPublishResult {
  sequenceNumber: number;
  consensusTimestamp: string;
  messageHash: string;
}

export interface HcsConfig {
  topicId: string;
  network: string;
}

export async function getOrCreateTopic(): Promise<string> {
  const path = "deployments/hcs.json";
  if (existsSync(path)) {
    const cfg = JSON.parse(readFileSync(path, "utf-8")) as HcsConfig;
    if (cfg.topicId) return cfg.topicId;
  }

  const topicId = await createHcsTopic();
  mkdirSync("deployments", { recursive: true });
  writeFileSync(path, JSON.stringify({ topicId, network: "testnet" }, null, 2));
  return topicId;
}

/** Create a fresh HCS topic for one training run (never cached/reused). */
export async function createHcsTopic(log?: StepLogger): Promise<string> {
  const client = getHederaSdkClient();
  const tx = await new TopicCreateTransaction().execute(client);
  const receipt = await tx.getReceipt(client);
  const topicId = receipt.topicId!.toString();
  log?.info(`Created HCS topic for this run: ${topicId}`);
  return topicId;
}

export async function publishHcsMessage(
  topicId: string,
  type: HcsMessageType,
  payload: HcsCpuMessage,
  log?: StepLogger
): Promise<HcsPublishResult> {
  const body = JSON.stringify({ type, ...payload, ts: Date.now() });
  const messageHash = keccak256(toUtf8Bytes(body));
  log?.logHcs(type, topicId, 0, messageHash, body.slice(0, 80));

  const client = getHederaSdkClient();
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(body)
    .execute(client);
  const receipt = await tx.getReceipt(client);
  const record = await tx.getRecord(client);

  const sequenceNumber = receipt.topicSequenceNumber!.toNumber();
  const consensusTimestamp = record.consensusTimestamp.toString();

  log?.info(`HCS ${type} seq=${sequenceNumber} hash=${messageHash.slice(0, 18)}…`);

  return { sequenceNumber, consensusTimestamp, messageHash };
}
