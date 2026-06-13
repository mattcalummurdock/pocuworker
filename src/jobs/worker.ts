import { config as loadEnv } from "dotenv";
loadEnv();

// Sync log before heavy imports — visible in Cloud Run even if startup fails later.
process.stdout.write(`[jobs:worker] Boot ${new Date().toISOString()}\n`);

import { spawn, type ChildProcess } from "child_process";
import { createServer } from "http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

export const FIXED_TRAIN_ENV: Record<string, string> = {
  CPU_BATCH_PACKED: "1",
  CPU_HCS_BATCH_AUDIT: "0",
  CPU_IPFS_PIN_SCOPE: "final",
  CPU_IPFS_MODE: "1",
  CPU_BATCH_VIA_IPFS: "0",
  CPU_JUMBO_ETH: "1",
  TX_RECEIPT_POLL_MS: "400",
  MAX_TRAIN_SAMPLES: "2",
  TRAIN_EPOCHS: "1",
};

const STALE_RUNNING_JOB_MS = parseInt(process.env.STALE_RUNNING_JOB_MS ?? "90000", 10);
const MINT_FETCH_TIMEOUT_MS = parseInt(process.env.MINT_FETCH_TIMEOUT_MS ?? "120000", 10);
const POST_JOB_POLL_MS = parseInt(process.env.POST_JOB_POLL_MS ?? "3000", 10);
const JOB_DATA_BUCKET = process.env.JOB_DATA_BUCKET ?? "job-data";
const TRAIN_HEARTBEAT_MS = parseInt(process.env.TRAIN_HEARTBEAT_MS ?? "30000", 10);

/** Set while this process is inside runTrainingJob (avoids ghost DB "running" blocking forever). */
let activeJobInProcess: string | null = null;

export interface TrainingJobRow {
  id: string;
  status: string;
  use_case: string;
  architecture_id: string;
  architecture_name?: string;
  prepared_meta_path?: string;
  data_csv_path?: string;
  manifest_path?: string;
  target_column?: string;
  input_dim?: number;
  num_classes?: number;
  train_samples?: number;
  train_epochs?: number;
  logs?: string;
  user_account_id?: string;
  ap2_mandate_hash?: string;
  acp_order_id?: string;
  allowance_hbar?: number;
  created_at?: string;
  updated_at?: string;
}

function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket,
    },
  });
}

async function downloadJobPreparedData(
  sb: SupabaseClient,
  job: TrainingJobRow,
  repoRoot: string
): Promise<string> {
  const dataDir = join(repoRoot, "data", job.id);
  const localMeta = join(dataDir, "meta.json");
  const localCsv = join(dataDir, "prepared.csv");

  if (existsSync(localMeta) && existsSync(localCsv)) {
    const meta = JSON.parse(readFileSync(localMeta, "utf-8")) as Record<string, unknown>;
    if (meta.outputCsvPath !== localCsv) {
      meta.outputCsvPath = localCsv;
      writeFileSync(localMeta, JSON.stringify(meta, null, 2));
    }
    console.log(`[jobs:worker] Using cached prepared data for ${job.id}`);
    return localMeta;
  }

  if (job.prepared_meta_path && existsSync(job.prepared_meta_path)) {
    console.log(`[jobs:worker] Using shared prepared path for ${job.id}`);
    return job.prepared_meta_path;
  }

  console.log(
    `[jobs:worker] Downloading prepared data for ${job.id} from ${JOB_DATA_BUCKET} storage`
  );
  mkdirSync(dataDir, { recursive: true });

  const { data: metaBlob, error: metaErr } = await sb.storage
    .from(JOB_DATA_BUCKET)
    .download(`${job.id}/meta.json`);
  if (metaErr || !metaBlob) {
    throw new Error(
      `Prepared data missing on worker and not in Supabase storage (${JOB_DATA_BUCKET}/${job.id}/). ` +
        "Create the job-data bucket, redeploy the agent, and queue a new job."
    );
  }

  const { data: csvBlob, error: csvErr } = await sb.storage
    .from(JOB_DATA_BUCKET)
    .download(`${job.id}/prepared.csv`);
  if (csvErr || !csvBlob) {
    throw new Error(`Prepared CSV missing in Supabase storage for job ${job.id}`);
  }

  const metaText = await metaBlob.text();
  writeFileSync(localMeta, metaText);
  writeFileSync(localCsv, Buffer.from(await csvBlob.arrayBuffer()));

  const meta = JSON.parse(metaText) as Record<string, unknown>;
  meta.outputCsvPath = localCsv;
  writeFileSync(localMeta, JSON.stringify(meta, null, 2));

  console.log(`[jobs:worker] Prepared data ready at ${localMeta}`);
  return localMeta;
}

function pipeTrainOutput(
  sb: SupabaseClient,
  jobId: string,
  stream: NodeJS.ReadableStream | null,
  label: "stdout" | "stderr"
): void {
  stream?.on("data", (chunk) => {
    const text = chunk.toString().trimEnd();
    if (!text) return;
    for (const line of text.split("\n")) {
      console.log(`[jobs:worker][train][${label}] ${line}`);
    }
    void appendLog(sb, jobId, text);
  });
}

function resolveHardhatCommand(repoRoot: string): { cmd: string; args: string[]; shell: boolean } {
  const isWin = process.platform === "win32";
  const hardhatBin = join(repoRoot, "node_modules", ".bin", isWin ? "hardhat.cmd" : "hardhat");
  if (existsSync(hardhatBin)) {
    return {
      cmd: hardhatBin,
      args: ["run", "scripts/train.ts", "--network", "testnet"],
      shell: isWin,
    };
  }
  return {
    cmd: isWin ? "npx.cmd" : "npx",
    args: ["hardhat", "run", "scripts/train.ts", "--network", "testnet"],
    shell: isWin,
  };
}

/** Always use a path under this worker's repo — ignore agent/container absolute paths in DB. */
export function resolveWorkerManifestPath(
  jobId: string,
  repoRoot: string,
  storedPath?: string
): string {
  const name = storedPath ? basename(storedPath.replace(/\\/g, "/")) : `${jobId}_manifest.json`;
  const fileName = name.endsWith("_manifest.json") ? name : `${jobId}_manifest.json`;
  return join(repoRoot, "output", fileName);
}

async function appendLog(sb: SupabaseClient, jobId: string, line: string): Promise<void> {
  const { data } = await sb.from("training_jobs").select("logs").eq("id", jobId).single();
  const prev = (data?.logs as string) ?? "";
  await sb
    .from("training_jobs")
    .update({ logs: prev + line + "\n" })
    .eq("id", jobId);
}

export async function markJobFailed(
  sb: SupabaseClient,
  jobId: string,
  msg: string
): Promise<void> {
  const { error } = await sb
    .from("training_jobs")
    .update({ status: "failed", error_message: msg, completed_at: new Date().toISOString() })
    .eq("id", jobId)
    .in("status", ["pending", "running", "awaiting_nft"]);
  if (error) throw error;
  await appendLog(sb, jobId, `[worker] FAILED: ${msg}`);
}

export async function markJobMintFailed(
  sb: SupabaseClient,
  jobId: string,
  msg: string
): Promise<void> {
  const { error } = await sb
    .from("training_jobs")
    .update({ status: "awaiting_nft", error_message: msg })
    .eq("id", jobId);
  if (error) throw error;
  await appendLog(sb, jobId, `[worker] NFT mint failed (retryable): ${msg}`);
}

function manifestExists(manifestPath: string): boolean {
  return existsSync(manifestPath) && statSync(manifestPath).size > 0;
}

export async function waitForStableFile(
  filePath: string,
  stableMs = 2000,
  timeoutMs = 3_600_000,
  pollMs = 500,
  shouldAbort?: () => boolean
): Promise<void> {
  const start = Date.now();
  let lastSize = -1;
  let stableSince = 0;

  while (Date.now() - start < timeoutMs) {
    if (shouldAbort?.()) {
      throw new Error(`Aborted waiting for manifest: ${filePath}`);
    }
    if (existsSync(filePath)) {
      const size = statSync(filePath).size;
      if (size > 0 && size === lastSize) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) return;
      } else {
        lastSize = size;
        stableSince = 0;
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timeout waiting for manifest: ${filePath}`);
}

export async function reconcileStaleRunningJobs(
  sb: SupabaseClient,
  repoRoot: string,
  staleMs = STALE_RUNNING_JOB_MS
): Promise<number> {
  const { data: running, error } = await sb.from("training_jobs").select("*").eq("status", "running");
  if (error) throw error;

  const now = Date.now();
  let recovered = 0;
  for (const job of (running ?? []) as TrainingJobRow[]) {
    const manifestPath = resolveWorkerManifestPath(job.id, repoRoot, job.manifest_path);
    if (manifestExists(manifestPath)) continue;

    const updatedAt = job.updated_at ?? job.created_at;
    const ageMs = updatedAt ? now - new Date(updatedAt).getTime() : staleMs;
    if (ageMs < staleMs) continue;

    const msg = "Training stopped unexpectedly (worker lost or timed out). Start a new job to retry.";
    await markJobFailed(sb, job.id, msg);
    console.log(`[jobs:worker] Recovered stale running job ${job.id}`);
    recovered++;
  }
  return recovered;
}

async function waitForChildExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

export async function uploadManifestToSupabase(
  sb: SupabaseClient,
  jobId: string,
  manifestPath: string
): Promise<string> {
  const body = readFileSync(manifestPath);
  const storagePath = `${jobId}/cpu_model_manifest.json`;
  const { error } = await sb.storage.from("trained-models").upload(storagePath, body, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data: signed } = await sb.storage
    .from("trained-models")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  if (!signed?.signedUrl) {
    const { data: pub } = sb.storage.from("trained-models").getPublicUrl(storagePath);
    return pub.publicUrl;
  }
  return signed.signedUrl;
}

async function fetchMintWithTimeout(url: string, jobId: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MINT_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Agent NFT mint timed out after ${MINT_FETCH_TIMEOUT_MS}ms (job ${jobId})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function runTrainingJob(job: TrainingJobRow, repoRoot: string): Promise<void> {
  const sb = getSupabase();
  const manifestPath = resolveWorkerManifestPath(job.id, repoRoot, job.manifest_path);
  mkdirSync(join(repoRoot, "output"), { recursive: true });
  activeJobInProcess = job.id;

  const { data: claimed, error: claimErr } = await sb
    .from("training_jobs")
    .update({ status: "running", manifest_path: manifestPath })
    .eq("id", job.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (claimErr) throw claimErr;
  if (!claimed) {
    console.log(`[jobs:worker] Job ${job.id} already claimed by another worker`);
    return;
  }

  console.log(`[jobs:worker] Claimed job ${job.id} (${job.use_case}) — preparing training`);

  try {
    const preparedMetaPath = await downloadJobPreparedData(sb, job, repoRoot);
    await appendLog(sb, job.id, `[worker] Starting train for ${job.use_case}`);
    console.log(`[jobs:worker] Starting train for ${job.use_case} (job ${job.id})`);

    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v != null) as [string, string][]
      ),
      ...FIXED_TRAIN_ENV,
      MAX_TRAIN_SAMPLES: String(job.train_samples ?? FIXED_TRAIN_ENV.MAX_TRAIN_SAMPLES),
      TRAIN_EPOCHS: String(job.train_epochs ?? FIXED_TRAIN_ENV.TRAIN_EPOCHS),
      ARCHITECTURE_ID: job.architecture_id,
      MANIFEST_PATH: manifestPath,
      JOB_ID: job.id,
      PREPARED_META_PATH: preparedMetaPath,
    };
    if (job.user_account_id) env.USER_ACCOUNT_ID = job.user_account_id;
    if (job.ap2_mandate_hash) env.AP2_MANDATE_HASH = job.ap2_mandate_hash;
    if (job.acp_order_id) env.ACP_ORDER_ID = job.acp_order_id;
    if (job.allowance_hbar != null) env.ALLOWANCE_HBAR = String(job.allowance_hbar);
    if (process.env.ACCOUNT_ID) env.AGENT_ACCOUNT_ID = process.env.ACCOUNT_ID;
    if (job.input_dim != null) env.INPUT_DIM = String(job.input_dim);
    if (job.num_classes != null) env.NUM_CLASSES = String(job.num_classes);

    const { cmd, args, shell } = resolveHardhatCommand(repoRoot);
    console.log(`[jobs:worker] Spawning: ${cmd} ${args.join(" ")}`);

    const child = spawn(cmd, args, {
      cwd: repoRoot,
      env,
      shell,
    });

    child.on("error", (err) => {
      console.error(`[jobs:worker] Train process error for ${job.id}: ${err.message}`);
    });

    pipeTrainOutput(sb, job.id, child.stdout, "stdout");
    pipeTrainOutput(sb, job.id, child.stderr, "stderr");

    const heartbeat = setInterval(() => {
      console.log(`[jobs:worker] Training still running for job ${job.id}...`);
    }, TRAIN_HEARTBEAT_MS);

    let childExited = false;
    const manifestPromise = waitForStableFile(manifestPath, 2000, 3_600_000, 500, () => childExited).catch(
      () => null
    );

    let exitCode = 1;
    try {
      exitCode = await waitForChildExit(child);
    } finally {
      clearInterval(heartbeat);
    }
    childExited = true;

    console.log(`[jobs:worker] Train process exited with code ${exitCode} (job ${job.id})`);

    if (exitCode !== 0) {
      await manifestPromise;
      throw new Error(`Training process exited with code ${exitCode}`);
    }

    await manifestPromise;
    if (!manifestExists(manifestPath)) {
      throw new Error("Training finished without manifest file");
    }

    await appendLog(sb, job.id, `[worker] Manifest ready: ${manifestPath}`);

    let manifest: Record<string, unknown> = {};
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      /* optional */
    }

    const modelUrl = await uploadManifestToSupabase(sb, job.id, manifestPath);
    const mppSpent = manifest.mppTotalSpentHbar ?? null;

    await sb
      .from("training_jobs")
      .update({
        status: "awaiting_nft",
        supabase_model_url: modelUrl,
        onchain_job_id: manifest.jobId ?? null,
        program_hash: manifest.programHash ?? null,
        weights_hash: manifest.weightsHash ?? null,
        hcs_topic_id: manifest.hcsTopicId ?? null,
        ipfs_uri: manifest.ipfsUri ?? null,
        total_spent_hbar: mppSpent,
        acp_status: "PROCESSING",
        acp_progress_pct: 90,
      })
      .eq("id", job.id);

    await appendLog(sb, job.id, `[worker] Training done — requesting agent HTS mint`);
    console.log(`[jobs:worker] Training done for ${job.id} — calling agent mint`);

    const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:8000";
    console.log(`[jobs:worker] POST ${agentUrl}/jobs/${job.id}/mint-model-nft`);
    const mintRes = await fetchMintWithTimeout(`${agentUrl}/jobs/${job.id}/mint-model-nft`, job.id);
    if (!mintRes.ok) {
      const errText = await mintRes.text();
      const mintErr = `Agent NFT mint failed: ${errText}`;
      await markJobMintFailed(sb, job.id, mintErr);
      throw new Error(mintErr);
    }
    const mintBody = (await mintRes.json()) as Record<string, unknown>;
    await appendLog(
      sb,
      job.id,
      `[worker] NFT minted token=${mintBody.model_nft_token_id} serial=${mintBody.model_nft_serial}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("NFT mint failed")) {
      await markJobFailed(sb, job.id, msg);
    }
    throw err;
  } finally {
    if (activeJobInProcess === job.id) {
      activeJobInProcess = null;
    }
  }
}

export async function processPendingJobs(repoRoot: string): Promise<number> {
  if (activeJobInProcess) {
    console.log(`[jobs:worker] Busy with job ${activeJobInProcess} in this process`);
    return 0;
  }

  const sb = getSupabase();

  const recovered = await reconcileStaleRunningJobs(sb, repoRoot);
  if (recovered > 0) {
    console.log(`[jobs:worker] Marked ${recovered} stale running job(s) as failed`);
  }

  const { data: jobs, error } = await sb
    .from("training_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  if (!jobs?.length) return 0;

  const job = jobs[0] as TrainingJobRow;
  try {
    await runTrainingJob(job, repoRoot);
  } catch {
    /* runTrainingJob already marked failed */
  }
  return 1;
}

const POLL_MS = parseInt(process.env.JOB_WORKER_POLL_MS ?? "15000", 10);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function startHealthServer(): void {
  const port = parseInt(process.env.PORT ?? "8080", 10);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`[jobs:worker] Health server on 0.0.0.0:${port}`);
  });
  server.on("error", (err) => {
    console.error(`[jobs:worker] Health server error: ${err instanceof Error ? err.message : err}`);
  });
}

function logStartupConfig(repoRoot: string): void {
  const deploymentPath = join(repoRoot, "deployments", "testnet.json");
  const config = {
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ACCOUNT_ID: Boolean(process.env.ACCOUNT_ID),
    HEX_ENCODED_PRIVATE_KEY: Boolean(process.env.HEX_ENCODED_PRIVATE_KEY),
    AGENT_SERVICE_URL: Boolean(process.env.AGENT_SERVICE_URL),
    deploymentFile: existsSync(deploymentPath),
    cwd: repoRoot,
    node: process.version,
  };
  console.log(`[jobs:worker] Startup config: ${JSON.stringify(config)}`);
}

async function pollOnce(repoRoot: string, label: string): Promise<number> {
  console.log(`[jobs:worker] ${label}`);
  let n = 0;
  try {
    n = await processPendingJobs(repoRoot);
    if (n === 0) {
      console.log(`[jobs:worker] No pending jobs`);
    } else {
      console.log(`[jobs:worker] Processed ${n} job(s)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[jobs:worker] Poll error: ${msg}`);
  }
  return n;
}

async function main() {
  startHealthServer();
  const repoRoot = process.cwd();
  logStartupConfig(repoRoot);

  const once = process.argv.includes("--once");
  console.log(
    once
      ? "[jobs:worker] Mode: single poll (--once)"
      : `[jobs:worker] Mode: continuous (idle poll every ${POLL_MS}ms)`
  );

  // First poll runs immediately — no initial sleep.
  let n = await pollOnce(repoRoot, "Immediate poll on startup");
  if (once) return;

  while (true) {
    const waitMs = n === 0 ? POLL_MS : POST_JOB_POLL_MS;
    console.log(`[jobs:worker] Next poll in ${waitMs / 1000}s`);
    await sleep(waitMs);
    n = await pollOnce(repoRoot, "Scheduled poll");
  }
}

if (require.main === module) {
  process.on("uncaughtException", (err) => {
    console.error("[jobs:worker] Uncaught exception:", err);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[jobs:worker] Unhandled rejection:", reason);
    process.exit(1);
  });

  main().catch((err) => {
    console.error("[jobs:worker] Fatal:", err);
    process.exit(1);
  });
}
