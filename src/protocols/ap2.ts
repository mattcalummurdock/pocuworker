import { createHash } from "crypto";

export const ALLOWANCE_HBAR = 200;
export const MANDATE_TTL_SEC = 2 * 60 * 60;

export interface Ap2Budget {
  amount: number;
  currency: "HBAR";
}

export interface Ap2OpenMandate {
  vct: "mandate.payment.open.1";
  service: "train_ml_model";
  intent: string;
  purpose: string;
  budget: Ap2Budget;
  agent_account: string;
  user_account: string;
  exp: number;
  iat: number;
}

export function buildAp2Mandate(params: {
  intent: string;
  userAccountId: string;
  agentAccountId: string;
  budgetHbar?: number;
}): Ap2OpenMandate {
  const now = Math.floor(Date.now() / 1000);
  return {
    vct: "mandate.payment.open.1",
    service: "train_ml_model",
    intent: params.intent,
    purpose: `Authorize agent to spend up to ${params.budgetHbar ?? ALLOWANCE_HBAR} HBAR for on-chain ML training`,
    budget: { amount: params.budgetHbar ?? ALLOWANCE_HBAR, currency: "HBAR" },
    agent_account: params.agentAccountId,
    user_account: params.userAccountId,
    iat: now,
    exp: now + MANDATE_TTL_SEC,
  };
}

/** Deterministic JSON for signing and hashing. */
export function canonicalizeMandate(mandate: Ap2OpenMandate): string {
  const ordered: Record<string, unknown> = {
    agent_account: mandate.agent_account,
    budget: { amount: mandate.budget.amount, currency: mandate.budget.currency },
    exp: mandate.exp,
    iat: mandate.iat,
    intent: mandate.intent,
    purpose: mandate.purpose,
    service: mandate.service,
    user_account: mandate.user_account,
    vct: mandate.vct,
  };
  return JSON.stringify(ordered);
}

export function mandateHash(mandate: Ap2OpenMandate): string {
  return createHash("sha256").update(canonicalizeMandate(mandate)).digest("hex");
}

export function isMandateExpired(mandate: Ap2OpenMandate, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return nowSec >= mandate.exp;
}

export function mandateMessageBytes(mandate: Ap2OpenMandate): Uint8Array {
  return new TextEncoder().encode(canonicalizeMandate(mandate));
}
