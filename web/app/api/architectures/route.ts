import { NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:8000";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tier = searchParams.get("tier");
  const url = tier
    ? `${AGENT_URL}/architectures?tier=${encodeURIComponent(tier)}`
    : `${AGENT_URL}/architectures`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    return new NextResponse(text || "Agent architectures request failed", {
      status: res.status,
    });
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return new NextResponse("Agent returned invalid JSON for architectures", {
      status: 502,
    });
  }
  if (!Array.isArray(data)) {
    return new NextResponse("Agent architectures response is not an array", {
      status: 502,
    });
  }
  return NextResponse.json(data);
}
