import {
  AccountId,
  Client,
  PrivateKey,
} from "@hashgraph/sdk";
import { getBytes, keccak256 } from "ethers";

let cachedClient: Client | null = null;

export function getHederaSdkClient(): Client {
  if (cachedClient) return cachedClient;

  const accountId = process.env.ACCOUNT_ID;
  const rawKey = process.env.HEX_ENCODED_PRIVATE_KEY;
  if (!accountId || !rawKey) {
    throw new Error("ACCOUNT_ID and HEX_ENCODED_PRIVATE_KEY required for Hedera SDK");
  }

  const client = Client.forTestnet();
  const key = rawKey.startsWith("0x")
    ? PrivateKey.fromStringECDSA(rawKey)
    : PrivateKey.fromStringECDSA(`0x${rawKey}`);
  client.setOperator(AccountId.fromString(accountId), key);
  cachedClient = client;
  return client;
}

export function isHederaNetwork(chainId: bigint | number | undefined): boolean {
  if (chainId == null) return false;
  return Number(chainId) === 296;
}

export function bytesToHex(data: Uint8Array): string {
  return `0x${Buffer.from(data).toString("hex")}`;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Uint8Array.from(Buffer.from(h, "hex"));
}

/** Keccak-256 hash of a signed Ethereum RLP transaction (32-byte EVM tx id). */
export function evmTxHashFromSignedRlp(signedRlpHex: string): string {
  return keccak256(getBytes(signedRlpHex));
}

/** Resolve the hash `eth_getTransactionReceipt` expects on Hedera. */
export function evmTxHashFromHederaRecord(
  record: { ethereumHash?: Uint8Array | null; transactionHash: Uint8Array },
  signedRlpHex?: string
): string {
  if (record.ethereumHash && record.ethereumHash.length === 32) {
    return bytesToHex(record.ethereumHash);
  }
  if (signedRlpHex) {
    return evmTxHashFromSignedRlp(signedRlpHex);
  }
  throw new Error(
    "Hedera record has no ethereumHash and no signed RLP was provided for hash derivation"
  );
}
