import { keccak256 } from "ethers";
import { HarvestedTx } from "./types";

const MIRROR_BASE = "https://testnet.mirrornode.hedera.com/api/v1";

interface MirrorTransaction {
  transaction_hash: string;
  consensus_timestamp: string;
}

interface MirrorResponse {
  transactions: MirrorTransaction[];
  links?: { next?: string };
}

function normalizeTxHash(raw: string): string {
  if (raw.startsWith("0x") && raw.length === 66) return raw;
  const buf = raw.startsWith("0x")
    ? Buffer.from(raw.slice(2), "hex")
    : Buffer.from(raw, "base64");
  return keccak256(buf);
}

export async function harvestTxHashes(count: number): Promise<HarvestedTx[]> {
  const results: HarvestedTx[] = [];
  let url: string | null = `${MIRROR_BASE}/transactions?limit=100&order=desc&transactiontype=cryptotransfer`;

  while (results.length < count && url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Mirror node error: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as MirrorResponse;

    for (const tx of data.transactions ?? []) {
      if (!tx.transaction_hash) continue;
      const hash = normalizeTxHash(tx.transaction_hash);
      results.push({ hash, timestamp: tx.consensus_timestamp });
      if (results.length >= count) break;
    }

    url = data.links?.next
      ? `https://testnet.mirrornode.hedera.com${data.links.next}`
      : null;
  }

  if (results.length < count) {
    throw new Error(`Only harvested ${results.length}/${count} transaction hashes`);
  }

  return results.slice(0, count);
}

export function timestampToBias(timestamp: string): bigint {
  const parts = timestamp.split(".");
  const frac = parts[1] ?? "0";
  const low = parseInt(frac.slice(0, 6).padEnd(6, "0"), 10);
  const normalized = (low % 1000) / 1000;
  return BigInt(Math.round(normalized * 65536));
}
