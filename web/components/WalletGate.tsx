"use client";

import { type ReactNode, useState } from "react";
import { useWallet } from "./WalletProvider";
import { PocuLogo } from "@/components/PocuLogo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function WalletGate({ children }: { children: ReactNode }) {
  const { accountId, connecting, connect, ready } = useWallet();
  const [error, setError] = useState<string | null>(null);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Initializing wallet…
      </div>
    );
  }

  if (!accountId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <Card className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 border-border duration-500">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3">
              <PocuLogo size={72} className="mx-auto shadow-[0_0_24px_oklch(0.7_0.18_145/0.35)]" priority />
            </div>
            <CardTitle className="text-2xl">POCU</CardTitle>
            <CardDescription className="text-base leading-relaxed">
              Connect your HashPack wallet to continue
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <p className="text-center text-sm text-destructive">{error}</p>
            )}
            <Button
              className="h-11 w-full bg-accent text-accent-foreground hover:bg-accent/90"
              disabled={connecting}
              onClick={() => {
                setError(null);
                void connect().catch((e) =>
                  setError(e instanceof Error ? e.message : String(e))
                );
              }}
            >
              {connecting ? "Connecting…" : "Connect Wallet"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
