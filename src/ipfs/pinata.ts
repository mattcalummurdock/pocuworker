/**
 * Pin tensor payloads to IPFS via Pinata (Phase B off-chain bytes).
 * Requires PINATA_JWT in environment.
 */

/** Pinning is opt-in: set CPU_IPFS_MODE=1 and PINATA_JWT (e.g. on testnet train). */
export function isPinataEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CPU_IPFS_MODE === "0") return false;
  return env.CPU_IPFS_MODE === "1" && Boolean(env.PINATA_JWT?.trim());
}

/** `final` = one manifest pin at commit (fast). `all` = every tensor (slow). `none` = no pins. */
export type IpfsPinScope = "final" | "all" | "none";

export function resolveIpfsPinScope(env: NodeJS.ProcessEnv = process.env): IpfsPinScope {
  const raw = (env.CPU_IPFS_PIN_SCOPE ?? "final").toLowerCase();
  if (raw === "all" || raw === "none") return raw;
  return "final";
}

/** Per-tensor Pinata pins during hydration — only when scope is `all`. */
export function shouldPinDuringHydrate(env: NodeJS.ProcessEnv = process.env): boolean {
  return isPinataEnabled(env) && resolveIpfsPinScope(env) === "all";
}

/** Single manifest pin after training — when scope is `final`. */
export function shouldPinManifest(env: NodeJS.ProcessEnv = process.env): boolean {
  return isPinataEnabled(env) && resolveIpfsPinScope(env) === "final";
}

export function ipfsUriFromCid(cid: string): string {
  return cid.startsWith("ipfs://") ? cid : `ipfs://${cid}`;
}

export function cidFromIpfsUri(uri: string): string {
  return uri.replace(/^ipfs:\/\//, "");
}

export function gatewayUrl(uri: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.PINATA_GATEWAY ?? "https://gateway.pinata.cloud/ipfs").replace(/\/$/, "");
  const cid = uri.replace(/^ipfs:\/\//, "");
  return `${base}/${cid}`;
}

export async function pinTensorJson(
  jobId: string,
  tensorId: string,
  shape: number[],
  data: bigint[]
): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT required for IPFS pinning");

  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      pinataContent: {
        jobId,
        tensorId,
        shape,
        data: data.map((d) => d.toString()),
      },
      pinataMetadata: {
        name: `tensor-${jobId.slice(2, 10)}-${tensorId.slice(2, 10)}`,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata pin failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { IpfsHash: string };
  return ipfsUriFromCid(json.IpfsHash);
}

/** Pin compact CPUB batch bytes for audit / off-chain replay. */
export async function pinBatchPayload(
  packed: Uint8Array,
  meta: { jobId: string; batchIndex: number; batchHash: string; payloadHash: string }
): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT required for batch IPFS");

  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      pinataContent: {
        format: "CPUB",
        version: 1,
        jobId: meta.jobId,
        batchIndex: meta.batchIndex,
        batchHash: meta.batchHash,
        payloadHash: meta.payloadHash,
        packedHex: Buffer.from(packed).toString("hex"),
      },
      pinataMetadata: {
        name: `batch-${meta.jobId.slice(2, 10)}-${meta.batchIndex}`,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata batch pin failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { IpfsHash: string };
  return ipfsUriFromCid(json.IpfsHash);
}

/** Pin trained model manifest (weights + metadata) — one CID for the whole model. */
export async function pinManifestJson(
  manifest: Record<string, unknown>
): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT required for IPFS pinning");

  const jobId = String(manifest.jobId ?? "unknown");
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      pinataContent: manifest,
      pinataMetadata: {
        name: `cpu-model-${jobId.slice(2, 10)}`,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata manifest pin failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { IpfsHash: string };
  return ipfsUriFromCid(json.IpfsHash);
}
