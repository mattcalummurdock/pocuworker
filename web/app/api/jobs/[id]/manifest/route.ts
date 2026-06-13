import { NextRequest, NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const accountId = req.nextUrl.searchParams.get("account_id")?.trim();
  if (!accountId) {
    return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  }

  const inline = req.nextUrl.searchParams.get("inline") === "1";
  const jobRes = await fetch(
    `${AGENT_URL}/jobs/${id}?user_account_id=${encodeURIComponent(accountId)}`,
    { cache: "no-store" }
  );
  if (!jobRes.ok) {
    return new NextResponse(await jobRes.text(), { status: jobRes.status });
  }

  const job = (await jobRes.json()) as { supabase_model_url?: string | null };
  const url = job.supabase_model_url;
  if (!url) {
    return NextResponse.json({ error: "Manifest not available yet" }, { status: 404 });
  }

  const fileRes = await fetch(url, { cache: "no-store" });
  if (!fileRes.ok) {
    return NextResponse.json({ error: "Failed to fetch manifest from storage" }, { status: 502 });
  }

  const body = await fileRes.arrayBuffer();

  if (inline) {
    try {
      const json = JSON.parse(Buffer.from(body).toString("utf-8"));
      return NextResponse.json(json);
    } catch {
      return NextResponse.json({ error: "Invalid manifest JSON" }, { status: 502 });
    }
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="cpu_model_manifest.json"',
      "Cache-Control": "private, no-cache",
    },
  });
}
