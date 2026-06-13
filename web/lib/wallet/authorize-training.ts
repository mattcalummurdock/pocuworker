"use client";

import {
  AccountAllowanceApproveTransaction,
  AccountId,
  Hbar,
  HbarUnit,
  TokenAssociateTransaction,
  TokenId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { buildAp2Mandate, canonicalizeMandate, type Ap2OpenMandate } from "./ap2";
import { ALLOWANCE_HBAR, requireWalletConfig } from "./config";
import { getDAppConnector, getHip30AccountId } from "./hedera-wallet";
import { fetchHbarAllowance, isTokenAssociated } from "./mirror";
import { pauseBetweenWalletSteps, walletSignAndExecute } from "./wallet-tx";

export interface WalletAuthResult {
  user_account_id: string;
  mandate: Ap2OpenMandate;
  mandate_signature: string;
  allowance_tx_id: string;
  associate_tx_id: string;
  initiation_tx_id?: string;
  acp_order_id?: string;
}

export type AuthorizeStep =
  | "mandate"
  | "allowance"
  | "associate"
  | "initiation_fee"
  | "agent_verify";

const STEP_MESSAGES: Record<AuthorizeStep, string> = {
  mandate: "Step 1/4 — Sign the AP2 mandate in HashPack (message only, not a payment).",
  allowance: `Step 2/4 — Approve ${ALLOWANCE_HBAR} HBAR allowance for training gas.`,
  associate: "Step 3/4 — Approve associating the model NFT token with your account.",
  initiation_fee: "Step 4/4 — Approve the small ACP job initiation fee transfer.",
  agent_verify: "Verifying authorization with the agent…",
};

interface PendingAuthPayload {
  user_account_id: string;
  mandate: Ap2OpenMandate;
  mandate_signature: string;
  allowance_tx_id: string;
  associate_tx_id: string;
  initiation_tx_id?: string;
  intent: string;
}

function pendingAuthKey(accountId: string): string {
  return `pocu_pending_auth:${accountId}`;
}

function savePendingAuth(accountId: string, payload: PendingAuthPayload): void {
  try {
    sessionStorage.setItem(pendingAuthKey(accountId), JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

function loadPendingAuth(accountId: string): PendingAuthPayload | null {
  try {
    const raw = sessionStorage.getItem(pendingAuthKey(accountId));
    if (!raw) return null;
    return JSON.parse(raw) as PendingAuthPayload;
  } catch {
    return null;
  }
}

export function clearPendingAuth(accountId: string): void {
  sessionStorage.removeItem(pendingAuthKey(accountId));
}

async function signMandate(accountId: string, message: string): Promise<string> {
  const dApp = await getDAppConnector();
  const result = await dApp.signMessage({
    signerAccountId: getHip30AccountId(accountId),
    message,
  });
  const r = result as { signatureMap?: string };
  const sig = r?.signatureMap;
  if (!sig) throw new Error("Wallet did not return mandate signature");
  console.log("[ap2] mandate signed");
  return sig;
}

async function postAuthorize(
  payload: PendingAuthPayload
): Promise<{ order_id?: string }> {
  const res = await fetch("/api/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet_auth: {
        user_account_id: payload.user_account_id,
        mandate: payload.mandate,
        mandate_signature: payload.mandate_signature,
        allowance_tx_id: payload.allowance_tx_id,
        associate_tx_id: payload.associate_tx_id,
        initiation_tx_id: payload.initiation_tx_id,
      },
      intent: payload.intent,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `Agent authorization failed (${res.status}): ${detail}. ` +
        "Wallet steps may have succeeded — click Start training again to retry agent verification."
    );
  }
  return (await res.json()) as { order_id?: string };
}

export async function authorizeTraining(
  intent: string,
  onStep?: (step: AuthorizeStep, message: string) => void
): Promise<WalletAuthResult> {
  const { agentAccountId, modelNftTokenId } = requireWalletConfig();
  const dApp = await getDAppConnector();
  if (dApp.signers.length === 0) {
    throw new Error("Connect HashPack before authorizing training");
  }
  const userAccountId = dApp.signers[0].getAccountId().toString();

  const report = (step: AuthorizeStep) => {
    const message = STEP_MESSAGES[step];
    onStep?.(step, message);
    console.log(`[wallet] ${message}`);
  };

  const pending = loadPendingAuth(userAccountId);
  if (pending?.mandate_signature && pending.allowance_tx_id && pending.associate_tx_id) {
    report("agent_verify");
    try {
      const authBody = await postAuthorize({ ...pending, intent: pending.intent || intent });
      clearPendingAuth(userAccountId);
      return {
        user_account_id: pending.user_account_id,
        mandate: pending.mandate,
        mandate_signature: pending.mandate_signature,
        allowance_tx_id: pending.allowance_tx_id,
        associate_tx_id: pending.associate_tx_id,
        initiation_tx_id: pending.initiation_tx_id,
        acp_order_id: authBody.order_id,
      };
    } catch (e) {
      console.warn("[wallet] pending auth retry failed", e);
    }
  }

  report("mandate");
  const mandate = buildAp2Mandate({ intent, userAccountId, agentAccountId });
  const mandate_signature = await signMandate(userAccountId, canonicalizeMandate(mandate));
  await pauseBetweenWalletSteps();

  let allowance_tx_id: string;
  const existingAllowance = await fetchHbarAllowance(userAccountId, agentAccountId);
  if (existingAllowance >= ALLOWANCE_HBAR) {
    allowance_tx_id = "existing_allowance";
    onStep?.(
      "allowance",
      `Step 2/4 — Allowance already set (${existingAllowance} HBAR). Skipping.`
    );
  } else {
    report("allowance");
    allowance_tx_id = await walletSignAndExecute(
      userAccountId,
      new AccountAllowanceApproveTransaction()
        .approveHbarAllowance(
          AccountId.fromString(userAccountId),
          AccountId.fromString(agentAccountId),
          Hbar.from(ALLOWANCE_HBAR, HbarUnit.Hbar)
        )
        .setTransactionMemo(`POCU training allowance ${ALLOWANCE_HBAR} HBAR`),
      "200 HBAR allowance"
    );
    await pauseBetweenWalletSteps();
  }

  let associate_tx_id: string;
  if (await isTokenAssociated(userAccountId, modelNftTokenId)) {
    associate_tx_id = "already_associated";
    onStep?.("associate", "Step 3/4 — Model NFT token already associated. Skipping.");
  } else {
    report("associate");
    try {
      associate_tx_id = await walletSignAndExecute(
        userAccountId,
        new TokenAssociateTransaction()
          .setAccountId(AccountId.fromString(userAccountId))
          .setTokenIds([TokenId.fromString(modelNftTokenId)]),
        "model NFT token associate"
      );
      await pauseBetweenWalletSteps();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/TOKEN_ALREADY_ASSOCIATED/i.test(msg)) {
        associate_tx_id = "already_associated";
      } else {
        throw e;
      }
    }
  }

  let initiation_tx_id: string | undefined;
  const initFee = parseFloat(process.env.NEXT_PUBLIC_ACP_INITIATION_FEE_HBAR ?? "0");
  if (initFee > 0) {
    report("initiation_fee");
    initiation_tx_id = await walletSignAndExecute(
      userAccountId,
      new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(userAccountId), Hbar.from(-initFee, HbarUnit.Hbar))
        .addHbarTransfer(AccountId.fromString(agentAccountId), Hbar.from(initFee, HbarUnit.Hbar))
        .setTransactionMemo("ACP job order initiation fee"),
      "ACP initiation fee"
    );
  }

  const pendingPayload: PendingAuthPayload = {
    user_account_id: userAccountId,
    mandate,
    mandate_signature,
    allowance_tx_id,
    associate_tx_id,
    initiation_tx_id,
    intent,
  };
  savePendingAuth(userAccountId, pendingPayload);

  report("agent_verify");
  const authBody = await postAuthorize(pendingPayload);
  clearPendingAuth(userAccountId);

  return {
    user_account_id: userAccountId,
    mandate,
    mandate_signature,
    allowance_tx_id,
    associate_tx_id,
    initiation_tx_id,
    acp_order_id: authBody.order_id,
  };
}
