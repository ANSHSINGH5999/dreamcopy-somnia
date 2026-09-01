import { DREAMDEX_REST_BASE } from "./chain";
import { MARKETS_FALLBACK } from "./marketsFallback";

// Real DreamDEX REST client. Contract addresses are NEVER hard-coded — every
// caller fetches them fresh from GET /v0/markets, per project rules (see
// dreamcopy/docs/ARCHITECTURE.md). The one exception is the last-resort
// fallback in marketsFallback.ts, used only when the live call fails and
// always disclosed via `_source` — see fetchMarketsWithFallback below.

export interface DreamDEXMarket {
  symbol: string;
  contract: `0x${string}`;
  // Declared by the real API per its schema, but unused anywhere in this
  // app (grep confirms) and absent from the verified fallback data — rather
  // than fabricate a placeholder address for a field nothing reads, this is
  // optional and simply omitted in fallback mode.
  stopRegistry?: `0x${string}`;
  base: `0x${string}`;
  baseDecimals: number;
  quote: `0x${string}`;
  quoteDecimals: number;
  kind: string;
  tickSize: string;
  lotSize: string;
  minQuantity: string;
}

export interface MarketsResult {
  markets: DreamDEXMarket[];
  _source: "live" | "fallback";
}

export async function fetchMarkets(): Promise<DreamDEXMarket[]> {
  const res = await fetch(`${DREAMDEX_REST_BASE}/markets`, {
    // Live market/contract data — never cache this at build time.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`DreamDEX /v0/markets returned ${res.status}`);
  }
  const data = (await res.json()) as { markets: DreamDEXMarket[] };
  return data.markets;
}

/// Same live call, cached 60s via Next.js's fetch cache, with a verified
/// last-resort fallback (see marketsFallback.ts) instead of throwing when
/// the live API is unreachable. This is the logic behind
/// web/src/app/api/markets/route.ts — the route calls this directly rather
/// than the page re-fetching its own route over HTTP during SSR (an
/// unnecessary self-referential round trip); the route exists so any
/// client-side code can hit /api/markets too.
export async function fetchMarketsWithFallback(): Promise<MarketsResult> {
  try {
    const res = await fetch(`${DREAMDEX_REST_BASE}/markets`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      throw new Error(`DreamDEX /v0/markets returned ${res.status}`);
    }
    const data = (await res.json()) as { markets: DreamDEXMarket[] };
    return { markets: data.markets, _source: "live" };
  } catch (err) {
    console.warn("[dreamdex] live /v0/markets fetch failed, using verified fallback:", err);
    return MARKETS_FALLBACK;
  }
}

// NOTE: there is no per-market `/v0/orderbook/{id}` REST endpoint — that path
// doesn't exist in the real API. The canonical REST orderbook call, per the
// official bot-kit client (packages/core/src/rest.ts, `fetchOrderbooks`), is
// `/orderbooks?symbols=...&depth=...`, and even that SDK types its response
// as `unknown` — DreamDEX hasn't published a firm schema for it. Rather than
// invent a `{ bids, asks }` shape and risk silently mis-rendering real data
// (see docs/LIMITATIONS.md), this returns the raw JSON and callers must
// narrow it defensively. For anything that needs a guaranteed-correct order
// book (e.g. sizing a trade), use the on-chain `getBookLevels` view on
// IDreamDEXPool instead — that ABI is verified against live contract
// bytecode (see contracts/test/CopyVault.fork.t.sol).
export async function fetchOrderbooksRaw(symbols: string[], depth = 5): Promise<unknown> {
  const q = encodeURIComponent(symbols.join(","));
  const res = await fetch(`${DREAMDEX_REST_BASE}/orderbooks?symbols=${q}&depth=${depth}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`DreamDEX /v0/orderbooks returned ${res.status}`);
  }
  return res.json();
}
