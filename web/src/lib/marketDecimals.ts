import { MARKETS_FALLBACK } from "./marketsFallback";

/// Maps a pool contract address (lowercased) to its base-token decimals,
/// reused from the same verified market data in marketsFallback.ts (every
/// value there was cross-checked against live `decimals()`/`getPoolParams()`
/// calls — see that file's header comment).
///
/// Used to convert copy_trades.quantity (raw base-token units) x price into
/// an approximate USDso notional for the analytics charts. CAVEAT: the
/// exact price/quantity scaling convention for a *real* fill depends on
/// detector.ts's still-unverified WS schema (no real payload has ever been
/// observed — see that file's header comment). This computes the standard
/// price*quantity/10^baseDecimals notional, which is correct if the
/// convention matches what detector.ts assumes; treat these charts as
/// directionally correct, not audited-precise, until that's confirmed.
const BASE_DECIMALS_BY_MARKET: Record<string, number> = Object.fromEntries(
  MARKETS_FALLBACK.markets.map((m) => [m.contract.toLowerCase(), m.baseDecimals]),
);

export function notionalUsdso(market: string, quantity: string, price: string): number {
  const baseDecimals = BASE_DECIMALS_BY_MARKET[market.toLowerCase()] ?? 18;
  try {
    const q = BigInt(quantity);
    const p = BigInt(price);
    // Keep this in bigint as long as possible, only converting to Number at
    // the very end for chart display — avoids precision loss on large
    // on-chain integers before the final divide.
    const scaled = (q * p) / 10n ** BigInt(baseDecimals);
    return Number(scaled) / 1e18; // USDso is 18 decimals (verified on-chain, see docs/ARCHITECTURE.md)
  } catch {
    return 0;
  }
}

export function marketSymbol(market: string): string {
  return (
    MARKETS_FALLBACK.markets.find((m) => m.contract.toLowerCase() === market.toLowerCase())?.symbol ??
    `${market.slice(0, 6)}…${market.slice(-4)}`
  );
}
