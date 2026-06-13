import {
  AccountId,
  Hbar,
  TransferTransaction,
} from "@hashgraph/sdk";
import { ethers } from "ethers";
import { getHederaSdkClient } from "../hedera-client";
import { StepLogger } from "../logger";
import { ALLOWANCE_CAP_HBAR } from "./cost-estimate";

export interface MppContext {
  ownerAccountId: string;
  agentAccountId: string;
  mandateHash: string;
  orderId: string;
  allowanceCapHbar: number;
}

/** Cumulative MPP reimbursements in HBAR (EVM gas cost uses wei; convert via formatEther). */
let cumulativeSpentHbar = 0;

export function resetMppSpendTracker(): void {
  cumulativeSpentHbar = 0;
}

export function getMppCumulativeSpentHbar(): number {
  return cumulativeSpentHbar;
}

export function gasCostFromReceipt(receipt: {
  gasUsed: bigint;
  gasPrice?: bigint | null;
}): bigint {
  const gasPrice = receipt.gasPrice ?? 0n;
  return receipt.gasUsed * gasPrice;
}

/** Project convention: ethers.formatEther(wei) yields the HBAR cost of an EVM tx. */
export function gasCostHbarFromWei(gasCostWei: bigint): number {
  return parseFloat(ethers.formatEther(gasCostWei));
}

export function wouldExceedMppCap(
  gasCostWei: bigint,
  allowanceCapHbar: number = ALLOWANCE_CAP_HBAR
): boolean {
  const batchHbar = gasCostHbarFromWei(gasCostWei);
  return cumulativeSpentHbar + batchHbar > allowanceCapHbar;
}

/** Reimburse agent gas from the user's pre-approved HBAR allowance (MPP). */
export async function reimburseGasReceipt(params: {
  ctx: MppContext | undefined;
  batchIndex: number;
  receipt: { gasUsed: bigint; gasPrice?: bigint | null };
  log?: StepLogger;
}): Promise<void> {
  if (!params.ctx) return;
  await executeMppPayment({
    ctx: params.ctx,
    gasCostWei: gasCostFromReceipt(params.receipt),
    batchIndex: params.batchIndex,
    log: params.log,
  });
}

export async function executeMppPayment(params: {
  ctx: MppContext;
  gasCostWei: bigint;
  batchIndex: number;
  log?: StepLogger;
}): Promise<string> {
  const { ctx, gasCostWei, batchIndex, log } = params;
  const batchHbar = gasCostHbarFromWei(gasCostWei);
  if (batchHbar <= 0) {
    log?.info(`[mpp] batch=${batchIndex} skip zero-cost reimbursement`);
    return "";
  }

  const nextTotal = cumulativeSpentHbar + batchHbar;
  if (nextTotal > ctx.allowanceCapHbar) {
    throw new Error(
      `[mpp] allowance cap exceeded: spent ${cumulativeSpentHbar.toFixed(4)} + ` +
        `batch ${batchHbar.toFixed(4)} > ${ctx.allowanceCapHbar} HBAR`
    );
  }

  const owner = AccountId.fromString(ctx.ownerAccountId);
  const agent = AccountId.fromString(ctx.agentAccountId);
  const client = getHederaSdkClient();

  const tx = await new TransferTransaction()
    .addApprovedHbarTransfer(owner, new Hbar(-batchHbar))
    .addHbarTransfer(agent, new Hbar(batchHbar))
    .setTransactionMemo(`MPP batch=${batchIndex} order=${ctx.orderId.slice(0, 8)} mandate=${ctx.mandateHash.slice(0, 16)}`)
    .execute(client);

  const receipt = await tx.getReceipt(client);
  if (!receipt.status.toString().includes("SUCCESS")) {
    throw new Error(`[mpp] transfer failed: ${receipt.status}`);
  }

  cumulativeSpentHbar = nextTotal;
  const txId = tx.transactionId.toString();
  const remaining = ctx.allowanceCapHbar - cumulativeSpentHbar;
  log?.info(
    `[mpp] batch=${batchIndex} gas=${batchHbar.toFixed(4)} HBAR reimbursed tx=${txId} ` +
      `spent_total=${cumulativeSpentHbar.toFixed(4)}/${ctx.allowanceCapHbar} allowance_remaining≈${remaining.toFixed(4)} HBAR`
  );
  return txId;
}
