"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { WalletAuthResult } from "@/lib/wallet/authorize-training";
import { clearPendingAuth } from "@/lib/wallet/authorize-training";
import {
  connectWallet,
  disconnectWallet,
  restoreWalletSession,
} from "@/lib/wallet/hedera-wallet";

interface WalletContextValue {
  accountId: string | null;
  connecting: boolean;
  ready: boolean;
  walletAuth: WalletAuthResult | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setWalletAuth: (auth: WalletAuthResult | null) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [ready, setReady] = useState(false);
  const [walletAuth, setWalletAuth] = useState<WalletAuthResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const restored = await restoreWalletSession();
        if (!cancelled && restored) setAccountId(restored);
      } catch (e) {
        console.error("[wallet] session restore error", e);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const id = await connectWallet();
      setAccountId(id);
    } catch (e) {
      console.error("[wallet] session error", e);
      throw e;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (accountId) clearPendingAuth(accountId);
    await disconnectWallet();
    setAccountId(null);
    setWalletAuth(null);
  }, [accountId]);

  const value = useMemo(
    () => ({
      accountId,
      connecting,
      ready,
      walletAuth,
      connect,
      disconnect,
      setWalletAuth,
    }),
    [accountId, connecting, ready, walletAuth, connect, disconnect]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
