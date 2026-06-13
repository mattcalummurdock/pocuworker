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
  const res = await fetch(
    `${AGENT_URL}/jobs/${id}?user_account_id=${encodeURIComponent(accountId)}`,
    { cache: "no-store" }
  );
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
