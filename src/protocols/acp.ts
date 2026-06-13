import { publishHcsMessage } from "../hcs";
import { StepLogger } from "../logger";

export type AcpStatus = "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";

export interface AcpOrderPayload {
  type: "ACP_ORDER";
  order_id: string;
  service: "train_ml_model";
  intent: string;
  budget_hbar: number;
  ap2_mandate_hash: string;
  status: AcpStatus;
  user_account?: string;
}

export interface AcpStatusPayload {
  type: "ACP_STATUS";
  order_id: string;
  status: AcpStatus;
  progress_pct?: number;
  message?: string;
  deliverable?: {
    model_nft?: string;
    model_nft_serial?: number;
    manifest_url?: string;
    hedera_proof?: string;
    total_spent_hbar?: number;
  };
  total_spent_hbar?: number;
}

export async function publishAcpOrder(
  topicId: string,
  payload: Omit<AcpOrderPayload, "type">,
  log?: StepLogger
): Promise<void> {
  const body: AcpOrderPayload = { type: "ACP_ORDER", ...payload };
  log?.info(`[acp] order created order_id=${payload.order_id} status=${payload.status}`);
  await publishHcsMessage(topicId, "ACP_ORDER", body as never, log);
}

export async function publishAcpStatus(
  topicId: string,
  payload: Omit<AcpStatusPayload, "type">,
  log?: StepLogger
): Promise<void> {
  const body: AcpStatusPayload = { type: "ACP_STATUS", ...payload };
  const pct = payload.progress_pct != null ? ` pct=${payload.progress_pct}` : "";
  log?.info(`[acp] status=${payload.status}${pct} order_id=${payload.order_id}`);
  await publishHcsMessage(topicId, "ACP_STATUS", body as never, log);
}
