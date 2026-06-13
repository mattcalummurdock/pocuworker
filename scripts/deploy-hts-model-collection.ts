import { config as loadEnv } from "dotenv";
loadEnv();

import { writeFileSync, mkdirSync } from "fs";
import {
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType,
  AccountId,
  PrivateKey,
} from "@hashgraph/sdk";
import { getHederaSdkClient } from "../src/hedera-client";

async function main() {
  const client = getHederaSdkClient();
  const accountId = AccountId.fromString(process.env.ACCOUNT_ID!);
  const rawKey = process.env.HEX_ENCODED_PRIVATE_KEY!;
  const supplyKey = rawKey.startsWith("0x")
    ? PrivateKey.fromStringECDSA(rawKey)
    : PrivateKey.fromStringECDSA(`0x${rawKey}`);

  console.log("[hts] Creating MODEL NFT collection…");
  const tx = await new TokenCreateTransaction()
    .setTokenName("POCU Model NFT")
    .setTokenSymbol("MODEL")
    .setTokenType(TokenType.NonFungibleUnique)
    .setDecimals(0)
    .setInitialSupply(0)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(100_000)
    .setTreasuryAccountId(accountId)
    .setSupplyKey(supplyKey)
    .setTokenMemo("On-Chain CPU trained model provenance NFTs")
    .execute(client);

  const receipt = await tx.getReceipt(client);
  const tokenId = receipt.tokenId!.toString();
  console.log(`[hts] Model NFT collection created: ${tokenId}`);

  const network = process.env.HEDERA_NETWORK ?? "testnet";
  const deployment = {
    modelNftTokenId: tokenId,
    tokenName: "POCU Model NFT",
    tokenSymbol: "MODEL",
    network,
    treasuryAccountId: accountId.toString(),
    maxSupply: 100_000,
    deployedAt: new Date().toISOString(),
    mirrorUrl: `https://${network}.mirrornode.hedera.com/api/v1/tokens/${tokenId}`,
    hashscanUrl: `https://hashscan.io/${network}/token/${tokenId}`,
  };

  mkdirSync("deployments", { recursive: true });
  writeFileSync("deployments/hts.json", JSON.stringify(deployment, null, 2));
  console.log("Saved deployments/hts.json (gitignored) — set MODEL_NFT_TOKEN_ID and NEXT_PUBLIC_MODEL_NFT_TOKEN_ID");
  console.log(`  MODEL_NFT_TOKEN_ID=${tokenId}`);
  console.log(`  NEXT_PUBLIC_MODEL_NFT_TOKEN_ID=${tokenId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
