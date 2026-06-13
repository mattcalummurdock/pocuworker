const MIRROR_URL =
  process.env.NEXT_PUBLIC_HEDERA_NETWORK === "mainnet"
    ? "https://mainnet.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

export async function fetchHbarAllowance(
  ownerAccountId: string,
  spenderAccountId: string
): Promise<number> {
  const res = await fetch(
    `${MIRROR_URL}/api/v1/accounts/${ownerAccountId}/allowances/crypto`
  );
  if (res.status === 404) return 0;
  if (!res.ok) return 0;
  const data = (await res.json()) as {
    allowances?: { spender?: string; amount?: number; amount_granted?: number }[];
  };
  for (const row of data.allowances ?? []) {
    if ((row.spender ?? "").trim() === spenderAccountId) {
      return Number(row.amount ?? row.amount_granted ?? 0) / 1e8;
    }
  }
  return 0;
}

export async function isTokenAssociated(
  ownerAccountId: string,
  tokenId: string
): Promise<boolean> {
  const res = await fetch(
    `${MIRROR_URL}/api/v1/accounts/${ownerAccountId}/tokens?token.id=${encodeURIComponent(tokenId)}`
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { tokens?: unknown[] };
  return (data.tokens?.length ?? 0) > 0;
}
