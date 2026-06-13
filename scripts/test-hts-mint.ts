/**
 * Dry-run metadata sizing + optional live mint against an awaiting_nft job.
 * Usage:
 *   npx ts-node --transpile-only scripts/test-hts-mint.ts
 *   npx ts-node --transpile-only scripts/test-hts-mint.ts --job <uuid> --live
 */
import { config } from "dotenv";
config();

const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:8000";
const live = process.argv.includes("--live");
const jobArg = process.argv.indexOf("--job");
const jobId = jobArg >= 0 ? process.argv[jobArg + 1] : undefined;

async function main() {
  const jobsRes = await fetch(`${agentUrl}/jobs?limit=10`);
  if (!jobsRes.ok) throw new Error(`GET /jobs failed: ${jobsRes.status}`);
  const jobs = (await jobsRes.json()) as Array<Record<string, unknown>>;

  const target =
    (jobId ? jobs.find((j) => j.id === jobId) : undefined) ??
    jobs.find((j) => j.status === "awaiting_nft") ??
    jobs.find((j) => j.status === "failed" && j.supabase_model_url);

  if (!target?.id) {
    console.log("No job with manifest found for mint test.");
    process.exit(1);
  }

  console.log(`Job: ${target.id} status=${target.status}`);

  const py = `
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "agent"))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from hts_mint import build_nft_metadata_bytes
job = json.loads(sys.stdin.read())
meta = build_nft_metadata_bytes(job)
print(json.dumps({"bytes": len(meta), "preview": meta.decode("utf-8", errors="replace")}))
`;

  const { spawnSync } = await import("child_process");
  const metaCheck = spawnSync("python", ["-c", py], {
    input: JSON.stringify(target),
    encoding: "utf-8",
    cwd: process.cwd(),
  });
  if (metaCheck.status !== 0) {
    console.error(metaCheck.stderr || metaCheck.stdout);
    process.exit(1);
  }
  const metaInfo = JSON.parse(metaCheck.stdout.trim()) as { bytes: number; preview: string };
  console.log(`Metadata: ${metaInfo.bytes} bytes — ${metaInfo.preview}`);
  if (metaInfo.bytes > 100) {
    throw new Error(`Metadata exceeds 100 byte HTS limit (${metaInfo.bytes})`);
  }

  if (!live) {
    console.log("OK: metadata within limit (pass --live to mint on testnet)");
    return;
  }

  const mintRes = await fetch(`${agentUrl}/jobs/${target.id}/mint-model-nft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const body = await mintRes.text();
  if (!mintRes.ok) {
    throw new Error(`Mint failed (${mintRes.status}): ${body}`);
  }
  console.log("Mint OK:", body);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
