"use client";

import { AccountId, Hbar, type Transaction, type TransactionResponse } from "@hiero-ledger/sdk";
import { getDAppConnector } from "./hedera-wallet";

const WALLET_TIMEOUT_MS = 120_000;

export function withWalletTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${WALLET_TIMEOUT_MS / 1000}s. ` +
            "Open the HashPack extension and approve any pending request, then retry."
        )
      );
    }, WALLET_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** HashPack signs and submits via WalletConnect — do not execute locally in the browser. */
export async function walletSignAndExecute(
  accountId: string,
  transaction: Transaction,
  label: string
): Promise<string> {
  const dApp = await getDAppConnector();
  const signer = dApp.getSigner(AccountId.fromString(accountId));
  const tx = transaction.setMaxTransactionFee(new Hbar(5));

  console.log(`[wallet] sign+execute via HashPack: ${label}`);
  const response = await withWalletTimeout(
    signer.call(tx) as Promise<TransactionResponse>,
    label
  );

  const txId = response?.transactionId?.toString();
  if (!txId) {
    console.warn("[wallet] HashPack response missing transactionId", response);
    return "submitted";
  }
  console.log(`[wallet] ${label} tx=${txId}`);
  return txId;
}

export async function pauseBetweenWalletSteps(ms = 750): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
