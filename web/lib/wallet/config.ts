export const ALLOWANCE_HBAR = 200;
export const MANDATE_TTL_SEC = 2 * 60 * 60;

export function requireWalletConfig(): {
  projectId: string;
  agentAccountId: string;
  network: "testnet" | "mainnet";
  modelNftTokenId: string;
} {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required — get one from https://cloud.reown.com"
    );
  }
  const agentAccountId = process.env.NEXT_PUBLIC_AGENT_ACCOUNT_ID?.trim();
  if (!agentAccountId) {
    throw new Error("NEXT_PUBLIC_AGENT_ACCOUNT_ID is required (same as root ACCOUNT_ID)");
  }
  const network = (process.env.NEXT_PUBLIC_HEDERA_NETWORK ?? "testnet") as "testnet" | "mainnet";
  const modelNftTokenId = process.env.NEXT_PUBLIC_MODEL_NFT_TOKEN_ID?.trim() ?? "";
  if (!modelNftTokenId) {
    throw new Error(
      "NEXT_PUBLIC_MODEL_NFT_TOKEN_ID is required — run scripts/deploy-hts-model-collection.ts"
    );
  }
  return { projectId, agentAccountId, network, modelNftTokenId };
}
