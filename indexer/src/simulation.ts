import { getCollateralToken, getTraderCapital } from "./executor.js";
import { getSimulationsForTrader, updateSimulation, type SimulationRow } from "./supabase.js";
import type { TradeEvent } from "./types.js";

/// "Paper trading" — updates every open simulation for traderId as its real
/// fills come in, sized proportionally to each simulation's virtual_deposit
/// exactly like a real follower pool (see executor.ts's
/// computeFollowerQuantity — same ratio, same fallback-to-1:1-if-capital-
/// unknown rule), and mirrors CopyVault.executeCopy's own cost-basis
/// accounting exactly (deployedCostBasis / basisReleased) so a later
/// "sell" releases the right share of virtual cost basis — see
/// docs/supabase_schema.sql's simulations comment for why those extra
/// columns exist. No real funds are ever touched.
///
/// price*quantity/1e18 is used as this fill's notional (matches
/// MockDreamDEXPool's own convention in the test suite) — same
/// estimate-not-audited caveat as the analytics dashboard's
/// notionalUsdso: a real fill's WS-schema-dependent scaling is unverified
/// (see detector.ts's header comment).
export async function updateSimulations(trade: TradeEvent, traderId: bigint, pool: string): Promise<void> {
  const sims = await getSimulationsForTrader(Number(traderId));
  if (sims.length === 0) return;

  let traderCapital: bigint;
  try {
    const collateralToken = await getCollateralToken();
    traderCapital = await getTraderCapital(trade.traderAddress, pool, collateralToken);
  } catch {
    traderCapital = 0n;
  }

  await Promise.all(sims.map((sim) => updateOneSimulation(sim, trade, traderCapital)));
}

async function updateOneSimulation(sim: SimulationRow, trade: TradeEvent, traderCapital: bigint): Promise<void> {
  const virtualNav = sim.virtual_deposit + sim.virtual_pnl;

  // Same ratio as a real follower pool — see executor.ts's
  // computeFollowerQuantity. Falls back to mirroring the trader's raw
  // quantity 1:1 if capital is unknown, same rule as the real flow.
  const traderQty = Number(trade.quantity);
  const virtualQty = traderCapital === 0n ? traderQty : (virtualNav * traderQty) / Number(traderCapital);

  const notional = (Number(trade.price) * virtualQty) / 1e18;

  let virtualPnl = sim.virtual_pnl;
  let virtualCostBasis = sim.virtual_cost_basis;
  let virtualBaseHeld = sim.virtual_base_held;
  const tradeCount = sim.trade_count + 1;

  if (trade.isBid) {
    virtualCostBasis += notional;
    virtualBaseHeld += virtualQty;
  } else {
    const basisReleased = virtualBaseHeld === 0 ? 0 : (virtualCostBasis * virtualQty) / virtualBaseHeld;
    virtualCostBasis -= basisReleased;
    virtualBaseHeld -= virtualQty;
    virtualPnl += notional - basisReleased; // realized P&L only, same philosophy as CopyVault
  }

  await updateSimulation(sim.id, {
    virtual_pnl: virtualPnl,
    virtual_cost_basis: virtualCostBasis,
    virtual_base_held: virtualBaseHeld,
    trade_count: tradeCount,
  });
}
