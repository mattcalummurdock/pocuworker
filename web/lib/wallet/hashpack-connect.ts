"use client";

import type { DAppConnector } from "@hashgraph/hedera-wallet-connect";

export function findHashpackExtension(dApp: DAppConnector) {
  return dApp.extensions.find(
    (ext) =>
      ext.id === "hashpack" ||
      ext.name?.toLowerCase().includes("hashpack")
  );
}

export async function waitForHashpackExtension(
  dApp: DAppConnector,
  maxMs = 2500
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (findHashpackExtension(dApp)?.available) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Prefer HashPack extension so each wallet request auto-opens the extension popup. */
export async function connectHashpackOrModal(dApp: DAppConnector): Promise<void> {
  await waitForHashpackExtension(dApp);
  const hashpack = findHashpackExtension(dApp);
  if (hashpack?.available) {
    console.log("[wallet] connecting via HashPack extension");
    await dApp.connectExtension(hashpack.id);
    return;
  }
  console.log("[wallet] HashPack extension not detected — opening WalletConnect modal");
  await dApp.openModal(undefined, true);
}
