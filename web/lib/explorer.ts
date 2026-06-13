export type HashscanNetwork = "testnet" | "mainnet";

export function getHashscanNetwork(): HashscanNetwork {
  const n = process.env.NEXT_PUBLIC_HEDERA_NETWORK ?? "testnet";
  return n === "mainnet" ? "mainnet" : "testnet";
}

function baseUrl(): string {
  return `https://hashscan.io/${getHashscanNetwork()}`;
}

export function getMirrorBaseUrl(): string {
  return getHashscanNetwork() === "mainnet"
    ? "https://mainnet.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";
}

const HEDERA_ID = /^0\.0\.\d+$/;

export function isHederaEntityId(value: string): boolean {
  return HEDERA_ID.test(value.trim());
}

export function isEvmBytes32(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value.trim());
}

/** 0.0.123@1234567890.123456789 → HashScan transaction URL */
export function hashscanFromNativeTransactionId(txId: string): string | null {
  const trimmed = txId.trim();
  const at = trimmed.indexOf("@");
  if (at === -1) return null;
  const account = trimmed.slice(0, at);
  const tsPart = trimmed.slice(at + 1);
  if (!isHederaEntityId(account) || !tsPart.includes(".")) return null;
  const [secs, nanos] = tsPart.split(".");
  if (!secs || !nanos) return null;
  const tid = `${account}-${secs}-${nanos}`;
  return `${baseUrl()}/transaction/${secs}.${nanos}?tid=${encodeURIComponent(tid)}`;
}

export function hashscanAccount(accountId: string): string {
  return `${baseUrl()}/account/${accountId.trim()}`;
}

export function hashscanTopic(topicId: string): string {
  return `${baseUrl()}/topic/${topicId.trim()}`;
}

/** NFT serial: /token/{tokenId}/{serialNumber} */
export function hashscanNft(tokenId: string, serial: number | string): string {
  return `${baseUrl()}/token/${tokenId.trim()}/${String(serial).trim()}`;
}

export function hashscanToken(tokenId: string): string {
  return `${baseUrl()}/token/${tokenId.trim()}`;
}

export function hashscanContract(addressOrId: string): string {
  return `${baseUrl()}/contract/${addressOrId.trim()}`;
}

export function hashscanEvmTransaction(evmHash: string): string {
  const h = evmHash.trim().startsWith("0x")
    ? evmHash.trim()
    : `0x${evmHash.trim()}`;
  return `${baseUrl()}/transaction/${h}`;
}

export function ipfsGateway(uri: string): string | null {
  const trimmed = uri.trim();
  if (trimmed.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${trimmed.slice(7)}`;
  }
  if (trimmed.startsWith("https://")) return trimmed;
  return null;
}

export type ExplorerLinkKind =
  | "account"
  | "topic"
  | "token"
  | "nft"
  | "contract"
  | "transaction"
  | "ipfs";

export function explorerUrl(
  value: string,
  kind: ExplorerLinkKind,
  serial?: number | string
): string | null {
  const v = value.trim();
  if (!v || v === "—") return null;

  switch (kind) {
    case "account":
      return isHederaEntityId(v) ? hashscanAccount(v) : null;
    case "topic":
      return isHederaEntityId(v) ? hashscanTopic(v) : null;
    case "token":
      return isHederaEntityId(v) ? hashscanToken(v) : null;
    case "nft":
      if (!isHederaEntityId(v)) return null;
      if (serial != null && serial !== "" && serial !== "?") {
        return hashscanNft(v, serial);
      }
      return hashscanToken(v);
    case "contract":
      return v.startsWith("0x") || isHederaEntityId(v) ? hashscanContract(v) : null;
    case "transaction": {
      const native = hashscanFromNativeTransactionId(v);
      if (native) return native;
      if (isEvmBytes32(v) || /^0x[a-fA-F0-9]+$/i.test(v)) {
        return hashscanEvmTransaction(v);
      }
      return null;
    }
    case "ipfs":
      return ipfsGateway(v);
    default:
      return null;
  }
}

/** Resolve EVM or native tx id to the best HashScan URL via mirror node. */
export async function resolveHashscanTransactionUrl(
  txIdOrHash: string
): Promise<string | null> {
  const v = txIdOrHash.trim();
  if (!v) return null;

  const native = hashscanFromNativeTransactionId(v);
  if (native) return native;

  if (!/^0x[a-fA-F0-9]+$/i.test(v)) return null;

  try {
    const res = await fetch(
      `${getMirrorBaseUrl()}/api/v1/contracts/results/${encodeURIComponent(v)}`
    );
    if (res.ok) {
      const data = (await res.json()) as {
        transaction_id?: string;
        transactions?: { transaction_id?: string }[];
      };
      const txId =
        data.transaction_id ?? data.transactions?.[0]?.transaction_id;
      if (txId) {
        const url = hashscanFromNativeTransactionId(txId);
        if (url) return url;
      }
    }
  } catch {
    /* fall through */
  }

  return hashscanEvmTransaction(v);
}

export function getCommitTxFromManifest(manifest: {
  trainingTxIds?: string[];
}): string | null {
  const ids = manifest.trainingTxIds;
  if (!ids?.length) return null;
  return ids[ids.length - 1] ?? null;
}
