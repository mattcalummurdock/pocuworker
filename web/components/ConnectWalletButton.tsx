"use client";

import { useWallet } from "./WalletProvider";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";
import { hashscanAccount, isHederaEntityId } from "@/lib/explorer";

export function ConnectWalletButton() {
  const { accountId, connecting, connect, disconnect } = useWallet();

  if (accountId) {
    const explorerHref = isHederaEntityId(accountId)
      ? hashscanAccount(accountId)
      : undefined;

    return (
      <div className="flex items-center gap-2 text-xs">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 font-mono text-foreground">
          <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" />
          {explorerHref ? (
            <a
              href={explorerHref}
              target="_blank"
              rel="noreferrer"
              className="max-w-[140px] truncate hover:underline sm:max-w-none"
            >
              {accountId}
            </a>
          ) : (
            <span className="truncate">{accountId}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void disconnect()}
          className="rounded-lg border border-border bg-card px-3 py-2 font-medium text-muted-foreground transition-colors hover:border-destructive hover:bg-destructive hover:text-white"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      disabled={connecting}
      onClick={() => void connect().catch(() => {})}
      className="bg-accent text-accent-foreground hover:bg-accent/90"
    >
      {connecting ? "Connecting…" : "Connect HashPack"}
    </Button>
  );
}
