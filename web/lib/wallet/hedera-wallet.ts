"use client";

import {
  DAppConnector,
  HederaChainId,
  HederaJsonRpcMethod,
  HederaSessionEvent,
} from "@hashgraph/hedera-wallet-connect";
import { LedgerId } from "@hiero-ledger/sdk";
import { connectHashpackOrModal } from "./hashpack-connect";

let connector: DAppConnector | null = null;
let initPromise: Promise<DAppConnector> | null = null;

function hip30AccountId(ledger: LedgerId, accountId: string): string {
  const network = ledger.isLocalNode() ? "devnet" : ledger.toString();
  return `hedera:${network}:${accountId}`;
}

export function getHip30AccountId(accountId: string): string {
  const { network } = requireWalletConfigSync();
  const ledger = network === "mainnet" ? LedgerId.MAINNET : LedgerId.TESTNET;
  return hip30AccountId(ledger, accountId);
}

function requireWalletConfigSync() {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required — get one from https://cloud.reown.com"
    );
  }
  const network = (process.env.NEXT_PUBLIC_HEDERA_NETWORK ?? "testnet") as
    | "testnet"
    | "mainnet";
  return { projectId, network };
}

async function createConnector(): Promise<DAppConnector> {
  const { projectId, network } = requireWalletConfigSync();
  const ledger = network === "mainnet" ? LedgerId.MAINNET : LedgerId.TESTNET;
  const chain =
    network === "mainnet" ? HederaChainId.Mainnet : HederaChainId.Testnet;

  const metadata = {
    name: "POCU",
    description: "POCU — Hedera on-chain ML training",
    url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3001",
    icons: [
      typeof window !== "undefined"
        ? `${window.location.origin}/logo/image.png`
        : "http://localhost:3001/logo/image.png",
    ],
  };

  console.log("[wallet] init DAppConnector");
  const dApp = new DAppConnector(
    metadata,
    ledger,
    projectId,
    Object.values(HederaJsonRpcMethod),
    [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
    [chain]
  );
  await dApp.init({ logger: "error" });
  return dApp;
}

export async function getDAppConnector(): Promise<DAppConnector> {
  if (connector) return connector;
  if (!initPromise) {
    initPromise = createConnector().then((d) => {
      connector = d;
      return d;
    });
  }
  return initPromise;
}

export async function restoreWalletSession(): Promise<string | null> {
  const dApp = await getDAppConnector();
  if (dApp.signers.length === 0) return null;
  const accountId = dApp.signers[0].getAccountId().toString();
  console.log(`[wallet] restored session ${accountId}`);
  return accountId;
}

export async function connectWallet(): Promise<string> {
  const dApp = await getDAppConnector();
  await connectHashpackOrModal(dApp);
  if (dApp.signers.length === 0) {
    throw new Error("No Hedera account returned from wallet");
  }
  const accountId = dApp.signers[0].getAccountId().toString();
  console.log(`[wallet] connected ${accountId}`);
  return accountId;
}

export async function disconnectWallet(): Promise<void> {
  if (!connector) return;
  await connector.disconnectAll();
  connector = null;
  initPromise = null;
  console.log("[wallet] disconnected");
}

export function getConnectedAccountId(): string | null {
  if (!connector || connector.signers.length === 0) return null;
  return connector.signers[0].getAccountId().toString();
}

/** @deprecated use getDAppConnector */
export async function getWalletProvider(): Promise<DAppConnector> {
  return getDAppConnector();
}
