import { NextResponse } from "next/server";
import { resolveHashscanTransactionUrl } from "@/lib/explorer";

export async function GET(req: Request) {
  const hash = new URL(req.url).searchParams.get("hash");
  if (!hash?.trim()) {
    return NextResponse.json({ error: "hash required" }, { status: 400 });
  }
  const url = await resolveHashscanTransactionUrl(hash);
  if (!url) {
    return NextResponse.json({ error: "Could not resolve transaction" }, { status: 404 });
  }
  return NextResponse.json({ url });
}
