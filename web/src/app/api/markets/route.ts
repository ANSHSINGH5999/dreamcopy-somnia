import { NextResponse } from "next/server";
import { fetchMarketsWithFallback } from "@/lib/dreamdex";

/// Proxies GET /v0/markets from the live DreamDEX staging API, cached 60s
/// (see fetchMarketsWithFallback), falling back to a verified static
/// snapshot (marketsFallback.ts) when the live API is unreachable — which
/// it has been for this entire project's build (see docs/ARCHITECTURE.md).
/// Always returns `_source: "live" | "fallback"` so callers can disclose
/// which one they got, never presenting stale data as current.
export async function GET() {
  const result = await fetchMarketsWithFallback();
  return NextResponse.json(result);
}
