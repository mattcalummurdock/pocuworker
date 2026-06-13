"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { useWallet } from "@/components/WalletProvider";
import { StatusBadge } from "@/components/jobs/StatusBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Job {
  id: string;
  status: string;
  use_case: string;
  architecture_name: string;
  architecture_id: string;
  kaggle_dataset_ref: string;
  train_samples: number;
  supabase_model_url: string | null;
  created_at: string;
}

export default function JobsPage() {
  const { accountId } = useWallet();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");

  async function load() {
    if (!accountId) return;
    try {
      const res = await fetch(
        `/api/jobs?account_id=${encodeURIComponent(accountId)}`
      );
      if (!res.ok) throw new Error(await res.text());
      setJobs(await res.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [accountId]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-6 duration-500">
      <div>
        <p className="text-sm text-muted-foreground">
          Your on-chain training jobs. Refreshes every 10 seconds.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error} — ensure Supabase is configured and agent is running.
        </div>
      )}

      <Card className="border-border py-0">
        <CardHeader className="border-b border-border px-6 py-5">
          <CardTitle className="text-base">Job history</CardTitle>
          <CardDescription>
            {jobs.length === 0 && !error
              ? "No jobs yet. Start one from the Agent page."
              : `${jobs.length} job${jobs.length === 1 ? "" : "s"} total`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {jobs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Status</TableHead>
                  <TableHead>Use case</TableHead>
                  <TableHead>Architecture</TableHead>
                  <TableHead>Dataset</TableHead>
                  <TableHead>Samples</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j, i) => (
                  <TableRow
                    key={j.id}
                    className="animate-in fade-in slide-in-from-left-2 hover:bg-secondary/50"
                    style={{
                      animationDelay: `${i * 50}ms`,
                      animationFillMode: "both",
                    }}
                  >
                    <TableCell>
                      <Link href={`/jobs/${j.id}`}>
                        <StatusBadge status={j.status} />
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">
                      {j.use_case}
                    </TableCell>
                    <TableCell>
                      {j.architecture_name ?? j.architecture_id}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                      {j.kaggle_dataset_ref ?? "—"}
                    </TableCell>
                    <TableCell>{j.train_samples ?? 2}</TableCell>
                    <TableCell>
                      {j.supabase_model_url && accountId ? (
                        <a
                          href={`/api/jobs/${j.id}/manifest?account_id=${encodeURIComponent(accountId)}`}
                          download="cpu_model_manifest.json"
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          <Download className="h-3.5 w-3.5" />
                          download
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(j.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            !error && (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                No jobs yet. Start one from the Agent page.
              </p>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
