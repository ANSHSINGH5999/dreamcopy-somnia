import { resolveMarketSymbol } from "./executor.js";
import { traderRegistry } from "./contracts.js";
import { insertWhaleAlert } from "./supabase.js";
import { notifyWhale } from "./telegram.js";
import type { TradeEvent } from "./types.js";

// USDso notional threshold above which a trader's own fill counts as
// "whale-sized" on testnet. Deliberately low (testnet liquidity is thin) —
// this is a demo threshold, not a mainnet-calibrated one.
const WHALE_THRESHOLD_USDSO = 1.0;

/// price*quantity/1e18 — same notional convention as simulation.ts (matches
/// MockDreamDEXPool's test-suite convention; a real fill's WS-schema-exact
/// scaling is unverified, see detector.ts's header comment).
function notionalUsdso(trade: TradeEvent): number {
  return (Number(trade.price) * Number(trade.quantity)) / 1e18;
}

/// Flags a trader's own fill as a whale alert when its USDso notional clears
/// WHALE_THRESHOLD_USDSO, regardless of whether our vault actually mirrors
/// it (same independence from isApprovedPool/dust-threshold as
/// updateSimulations — a whale alert describes the trader's real activity,
/// not our copy outcome). Logs to whale_alerts (public Realtime feed, see
/// WhaleAlertBanner.tsx) and broadcasts to the configured Telegram chat.
/// Never throws — called fire-and-forget from executor.ts.
export async function checkWhaleAlert(trade: TradeEvent, traderId: bigint, pool: string): Promise<void> {
  const notional = notionalUsdso(trade);
  if (notional < WHALE_THRESHOLD_USDSO) return;

  const [trader, marketSymbol] = await Promise.all([
    traderRegistry.getTrader(traderId) as Promise<{ label: string }>,
    resolveMarketSymbol(pool),
  ]);

  const side = trade.isBid ? "BUY" : "SELL";
  const qtyStr = notional.toFixed(2);

  await insertWhaleAlert({
    trader_id: Number(traderId),
    trader_label: trader.label,
    market_symbol: marketSymbol,
    is_bid: trade.isBid,
    quantity: notional,
  });

  await notifyWhale(`🐋 ${trader.label} ${marketSymbol} ${side} ${qtyStr} USDso`);
}
