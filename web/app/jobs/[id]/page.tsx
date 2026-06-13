"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { StatusBadge } from "@/components/jobs/StatusBadge";
import { ExplorerLink } from "@/components/jobs/ExplorerLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallet } from "@/components/WalletProvider";

function OnChainField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[140px_1fr] sm:gap-4">
      <Label className="text-muted-foreground">{label}</Label>
      <div className={`text-sm text-foreground ${mono ? "break-all font-mono text-xs" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function JobDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

export default function JobDetailPage() {
  const params = useParams();
  const { accountId } = useWallet();
  const id = params.id as string;
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!accountId) return;
    async function load() {
      try {
        const res = await fetch(
          `/api/jobs/${id}?account_id=${encodeURIComponent(accountId)}`
        );
        if (!res.ok) throw new Error(await res.text());
        setJob(await res.json());
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [id, accountId]);

  if (error) {
    return (
      <div className="space-y-4">
        <p className="text-destructive">{error}</p>
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to jobs
        </Link>
      </div>
    );
  }

  if (!job) {
    return <JobDetailSkeleton />;
  }

  const hasManifest = Boolean(job.supabase_model_url);
  const status = String(job.status ?? "unknown");
  const onchainJobId = String(job.onchain_job_id ?? "");
  const programHash = String(job.program_hash ?? "");
  const weightsHash = String(job.weights_hash ?? "");
  const hcsTopic = String(job.hcs_topic_id ?? "");
  const ipfsUri = String(job.ipfs_uri ?? "");
  const userAccount = String(job.user_account_id ?? "");
  const nftToken = job.model_nft_token_id
    ? String(job.model_nft_token_id)
    : "";
  const nftSerial = job.model_nft_serial;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6 duration-500">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to jobs
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">Job {id.slice(0, 8)}…</h2>
        <StatusBadge status={status} />
        {hasManifest && (
          <Button
            asChild
            size="sm"
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <a
              href={`/api/jobs/${id}/manifest?account_id=${encodeURIComponent(accountId ?? "")}`}
              download="cpu_model_manifest.json"
            >
              <Download className="h-4 w-4" />
              Download manifest
            </a>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-border py-5">
          <CardHeader className="px-5 pb-4">
            <CardTitle className="text-base">Training</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-5">
            <OnChainField label="Status" value={status} />
            <OnChainField label="Use case" value={String(job.use_case)} />
            <OnChainField label="User prompt" value={String(job.user_prompt || "—")} />
            <OnChainField
              label="Training"
              value={`${String(job.train_samples ?? 2)} samples · ${String(job.train_epochs ?? 1)} epoch(s)`}
            />
            <OnChainField
              label="Architecture"
              value={`${String(job.architecture_name ?? job.architecture_id)} (${String(job.architecture_tier)})`}
            />
            <OnChainField
              label="Kaggle"
              value={
                job.kaggle_url ? (
                  <a
                    href={String(job.kaggle_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    {String(job.kaggle_dataset_ref)}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <OnChainField
              label="Target column"
              value={String(job.target_column ?? "—")}
            />
          </CardContent>
        </Card>

        <Card className="border-border py-5">
          <CardHeader className="px-5 pb-4">
            <CardTitle className="text-base text-foreground">On-chain</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-5 text-foreground">
            <OnChainField
              label="Job ID"
              value={onchainJobId && onchainJobId !== "—" ? onchainJobId : "—"}
              mono
            />
            <OnChainField
              label="Program hash"
              value={programHash && programHash !== "—" ? programHash : "—"}
              mono
            />
            <OnChainField
              label="Weights hash"
              value={weightsHash && weightsHash !== "—" ? weightsHash : "—"}
              mono
            />
            <OnChainField
              label="HCS topic"
              value={
                hcsTopic && hcsTopic !== "—" ? (
                  <ExplorerLink value={hcsTopic} kind="topic" light />
                ) : (
                  "—"
                )
              }
            />
            <OnChainField
              label="IPFS"
              value={
                ipfsUri && ipfsUri !== "—" ? (
                  <ExplorerLink value={ipfsUri} kind="ipfs" light mono />
                ) : (
                  "—"
                )
              }
            />
            <OnChainField
              label="User account"
              value={
                userAccount && userAccount !== "—" ? (
                  <ExplorerLink value={userAccount} kind="account" light mono />
                ) : (
                  "—"
                )
              }
            />
            <OnChainField
              label="Model NFT"
              value={
                nftToken ? (
                  <ExplorerLink
                    value={nftToken}
                    kind="nft"
                    serial={nftSerial != null ? String(nftSerial) : undefined}
                    light
                    mono
                  >
                    {nftToken} #{String(nftSerial ?? "?")}
                  </ExplorerLink>
                ) : (
                  "—"
                )
              }
            />
          </CardContent>
        </Card>

        <Card className="border-border py-5 lg:col-span-2">
          <CardHeader className="px-5 pb-4">
            <CardTitle className="text-base">ACP & payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-5">
            <OnChainField
              label="ACP order"
              value={
                <>
                  {String(job.acp_order_id ?? "—")}
                  {job.acp_status ? ` · ${String(job.acp_status)}` : ""}
                  {job.acp_progress_pct != null
                    ? ` (${String(job.acp_progress_pct)}%)`
                    : ""}
                </>
              }
            />
            <OnChainField
              label="Total spent (MPP)"
              value={
                job.total_spent_hbar != null
                  ? `${String(job.total_spent_hbar)} HBAR`
                  : "—"
              }
            />
            <OnChainField
              label="Model file"
              value={
                hasManifest ? (
                  <a
                    href={`/api/jobs/${id}/manifest?account_id=${encodeURIComponent(accountId ?? "")}`}
                    download="cpu_model_manifest.json"
                    className="text-accent hover:underline"
                  >
                    Download manifest
                  </a>
                ) : (
                  "Pending…"
                )
              }
            />
            {job.error_message ? (
              <OnChainField
                label="Error"
                value={String(job.error_message)}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {job.logs ? (
        <Card className="border-border py-5">
          <CardHeader className="px-5 pb-4">
            <CardTitle className="text-base">Logs</CardTitle>
          </CardHeader>
          <CardContent className="px-5">
            <ScrollArea className="h-[400px] rounded-lg bg-secondary p-4">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {String(job.logs)}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
