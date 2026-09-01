import { Contract, type Log } from "ethers";
import { config } from "./config.js";
import { copyVault, dreamDexPoolAbi, provider, traderRegistry } from "./contracts.js";
import { notifyCopy, notifyStopLoss } from "./notifications.js";
import { updateSimulations } from "./simulation.js";
import { insertCopyTrade, type CopyTradeRow } from "./supabase.js";
import { notifyOperator } from "./telegram.js";
import type { TradeEvent } from "./types.js";
import { checkWhaleAlert } from "./whaleAlert.js";

interface DreamDEXMarket {
  symbol: string;
  contract: `0x${string}`;
}

let marketsCache: DreamDEXMarket[] = [];
let marketsCacheAt = 0;
const MARKETS_CACHE_TTL_MS = 60_000;

/// Fetches dreamcopy/docs/ARCHITECTURE.md's `GET /v0/markets` — never
/// hard-coded — with a short cache so a burst of fills doesn't hammer the
/// REST API once per trade.
async function fetchMarkets(): Promise<DreamDEXMarket[]> {
  const now = Date.now();
  if (marketsCache.length > 0 && now - marketsCacheAt < MARKETS_CACHE_TTL_MS) {
    return marketsCache;
  }
  const res = await fetch(`${config.restBase}/markets`);
  if (!res.ok) {
    throw new Error(`GET ${config.restBase}/markets returned ${res.status}`);
  }
  const data = (await res.json()) as { markets: DreamDEXMarket[] };
  marketsCache = data.markets;
  marketsCacheAt = now;
  return marketsCache;
}

/// Resolves detector.ts's `marketId` (whose exact meaning is UNVERIFIED —
/// see detector.ts's header comment) to a DreamDEX pool contract address.
/// Handles both cases: it's already a pool address, or it's a market symbol
/// that needs a live `/v0/markets` lookup.
async function resolvePoolAddress(marketId: string): Promise<`0x${string}` | null> {
  if (/^0x[0-9a-fA-F]{40}$/.test(marketId)) {
    return marketId as `0x${string}`;
  }
  const markets = await fetchMarkets();
  const match = markets.find((m) => m.symbol.toLowerCase() === marketId.toLowerCase());
  return match?.contract ?? null;
}

/// Human-readable symbol for a resolved pool address, for display in Telegram
/// alerts / whale_alerts rows (see whaleAlert.ts). Falls back to a truncated
/// address — same convention as web/src/lib/marketDecimals.ts's
/// marketSymbol — rather than failing the alert over a REST hiccup.
export async function resolveMarketSymbol(pool: string): Promise<string> {
  try {
    const markets = await fetchMarkets();
    const match = markets.find((m) => m.contract.toLowerCase() === pool.toLowerCase());
    if (match) return match.symbol;
  } catch {
    // fall through to the truncated-address fallback below
  }
  return `${pool.slice(0, 6)}…${pool.slice(-4)}`;
}

// CopyVault.collateralToken() is immutable on-chain — read it once and cache
// it, rather than duplicating the address in indexer config (same
// never-hard-code convention as the rest of this repo).
let cachedCollateralToken: string | null = null;
export async function getCollateralToken(): Promise<string> {
  if (!cachedCollateralToken) {
    cachedCollateralToken = (await copyVault.collateralToken()) as string;
  }
  return cachedCollateralToken;
}

/// The trader's own available capital on the resolved pool — the
/// denominator for proportional sizing.
///
/// NOTE: this does NOT come from TraderRegistry — that contract's Trader
/// struct is `{wallet, label, active, followerCount}` (see
/// contracts/src/TraderRegistry.sol) and has no capital/balance field at
/// all. The only real, verified on-chain source for a trader's deployable
/// capital on a given market is the DreamDEX pool contract itself, via
/// `getWithdrawableBalance` (contracts/src/interfaces/IDreamDEX.sol).
///
/// Returns 0n (rather than throwing) if the pool doesn't answer — this
/// deliberately routes into the same "traderCapital is 0" fallback as
/// genuinely-zero capital, so an unreadable balance never blocks a trade;
/// it just mirrors 1:1 instead.
export async function getTraderCapital(traderWallet: string, pool: string, collateralToken: string): Promise<bigint> {
  const dex = new Contract(pool, dreamDexPoolAbi, provider);
  try {
    return (await dex.getWithdrawableBalance(traderWallet, collateralToken)) as bigint;
  } catch (err) {
    console.warn(
      `[executor] could not read trader capital from pool ${pool} for ${traderWallet} — falling back to 1:1 mirror:`,
      err,
    );
    return 0n;
  }
}

/// Scales the trader's raw fill quantity to this trader's follower pool,
/// proportional to pool size vs. the trader's own capital:
///
///   followerQty = followerPoolNav * traderQty / traderCapital
///
/// (Multiply before dividing — doing `(followerNav / traderCapital) *
/// traderQty` in integer math truncates to 0 whenever followerNav <
/// traderCapital, which is the common case, and would silently kill every
/// trade. This ordering only loses the final division's remainder.)
///
/// Falls back to mirroring 1:1 when traderCapital is 0 or unreadable, per
/// spec — the on-chain InsufficientPoolBalance check in
/// CopyVault.executeCopy is still the final backstop either way.
async function computeFollowerQuantity(
  traderId: bigint,
  traderWallet: string,
  pool: string,
  traderQty: bigint,
): Promise<bigint> {
  const collateralToken = await getCollateralToken();
  const [followerNav, traderCapital] = (await Promise.all([
    copyVault.poolNav(traderId),
    getTraderCapital(traderWallet, pool, collateralToken),
  ])) as [bigint, bigint];

  if (traderCapital === 0n) {
    console.log(`[executor] traderCapital is 0 (or unreadable) for ${traderWallet} — mirroring 1:1`);
    return traderQty;
  }

  const scaled = (followerNav * traderQty) / traderCapital;
  console.log(
    `[executor] sizing: followerNav=${followerNav} traderCapital=${traderCapital} traderQty=${traderQty} ` +
      `-> followerQty=${scaled}`,
  );
  return scaled;
}

/// All wallets currently following traderId, for notification fan-out (see
/// notifications.ts's header comment on why there's no single recipient).
/// Falls back to an empty list on any error — including the expected
/// "function doesn't exist yet" revert until TraderRegistry's Feature 16
/// redeploy lands (see contracts.ts's getFollowers ABI comment) — so a
/// notification-only failure can never affect the trade itself.
async function getFollowersSafe(traderId: bigint): Promise<string[]> {
  try {
    return (await traderRegistry.getFollowers(traderId)) as string[];
  } catch {
    return [];
  }
}

// orderType = IMMEDIATE_OR_CANCEL (2) — "the taker default", verified from
// contracts/src/interfaces/IDreamDEX.sol's DreamDEXOrderType library.
const ORDER_TYPE_IMMEDIATE_OR_CANCEL = 2;
// builderFeeBpsTimes1k is always 0 — see docs/LIMITATIONS.md #6.
const BUILDER_FEE_BPS_TIMES_1K = 0;
// How far in the future an IOC order's expiry is set. IOC either fills or
// cancels immediately on submission, so this only needs to be non-expired
// at inclusion time — a short window is deliberately conservative.
const ORDER_EXPIRY_WINDOW_MS = 60_000;

/// Logs one row to copy_trades for this attempt, regardless of outcome.
/// Never lets a logging failure propagate — see supabase.ts.
function logAttempt(
  trade: TradeEvent,
  traderId: bigint,
  market: string,
  quantity: bigint,
  fields: Pick<CopyTradeRow, "status" | "tx_hash" | "skip_reason">,
): void {
  const row: CopyTradeRow = {
    trader_id: Number(traderId),
    follower: null,
    market,
    is_bid: trade.isBid,
    quantity: quantity.toString(),
    price: trade.price.toString(),
    ...fields,
  };
  void insertCopyTrade(row);
}

/// Mirrors one detected trader fill by calling CopyVault.executeCopy, sized
/// proportionally to this trader's follower pool (see
/// computeFollowerQuantity). Never throws — every failure is logged (to
/// stdout, Telegram, and copy_trades) and swallowed so one bad trade can't
/// take the indexer down.
export async function handleTrade(trade: TradeEvent, traderId: bigint): Promise<void> {
  try {
    const pool = await resolvePoolAddress(trade.marketId);
    if (!pool) {
      const reason = `could not resolve marketId "${trade.marketId}" to a pool address`;
      console.warn(`[executor] ${reason} — skipping`);
      logAttempt(trade, traderId, trade.marketId, trade.quantity, {
        status: "skipped",
        tx_hash: null,
        skip_reason: reason,
      });
      return;
    }

    // Simulations are independent of whether OUR vault has this pool
    // approved or has enough real balance — they track the trader's raw
    // fill regardless, so this runs before either check below.
    await updateSimulations(trade, traderId, pool).catch((err) => {
      console.error(`[executor] updateSimulations failed for traderId=${traderId}:`, err);
    });

    // Whale alerts describe the trader's own fill, independent of whether
    // our vault mirrors it — same reasoning as updateSimulations above, so
    // this runs before the isApprovedPool check too.
    await checkWhaleAlert(trade, traderId, pool).catch((err) => {
      console.error(`[executor] checkWhaleAlert failed for traderId=${traderId}:`, err);
    });

    const approved: boolean = await copyVault.isApprovedPool(pool);
    if (!approved) {
      const reason = `pool ${pool} (market ${trade.marketId}) is not approved on CopyVault`;
      console.warn(`[executor] ${reason} — skipping trade from ${trade.traderAddress}`);
      logAttempt(trade, traderId, pool, trade.quantity, {
        status: "skipped",
        tx_hash: null,
        skip_reason: reason,
      });
      return;
    }

    const followerQty = await computeFollowerQuantity(traderId, trade.traderAddress, pool, trade.quantity);

    if (followerQty < config.dustThreshold) {
      const reason = `scaled quantity ${followerQty} is below dust threshold ${config.dustThreshold}`;
      console.log(`[executor] ${reason} — skipping trade from ${trade.traderAddress}`);
      logAttempt(trade, traderId, pool, followerQty, {
        status: "skipped",
        tx_hash: null,
        skip_reason: reason,
      });
      return;
    }

    const expireTimestampNs = BigInt(Date.now() + ORDER_EXPIRY_WINDOW_MS) * 1_000_000n;

    console.log(
      `[executor] mirroring trader=${trade.traderAddress} traderId=${traderId} pool=${pool} ` +
        `${trade.isBid ? "BUY" : "SELL"} qty=${followerQty} (trader's raw fill was ${trade.quantity}) @ ${trade.price}`,
    );

    const tx = await copyVault.executeCopy(
      traderId,
      pool,
      trade.isBid,
      trade.price,
      followerQty,
      expireTimestampNs,
      ORDER_TYPE_IMMEDIATE_OR_CANCEL,
      BUILDER_FEE_BPS_TIMES_1K,
    );
    console.log(`[executor] tx submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      console.error(`[executor] tx reverted: ${tx.hash}`);
      logAttempt(trade, traderId, pool, followerQty, {
        status: "failed",
        tx_hash: tx.hash,
        skip_reason: null,
      });
      await notifyOperator(`Copy trade tx reverted for trader ${trade.traderAddress} (${tx.hash})`);
      return;
    }

    console.log(`[executor] tx confirmed: ${tx.hash}`);
    logAttempt(trade, traderId, pool, followerQty, {
      status: "success",
      tx_hash: tx.hash,
      skip_reason: null,
    });

    const followers = await getFollowersSafe(traderId);
    await notifyCopy(trade, followers);

    // Did this fill also trip the pool-wide stop-loss? (CopyVault emits
    // StopLossTriggered in the same tx — see contracts/src/CopyVault.sol.)
    const stopLossHit = receipt.logs.some((log: Log) => {
      try {
        return copyVault.interface.parseLog(log)?.name === "StopLossTriggered";
      } catch {
        return false;
      }
    });
    if (stopLossHit) {
      await notifyStopLoss(trade.traderAddress, followers);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[executor] failed to execute copy trade for ${trade.traderAddress}:`, err);
    logAttempt(trade, traderId, trade.marketId, trade.quantity, {
      status: "failed",
      tx_hash: null,
      skip_reason: message,
    });
    await notifyOperator(`Copy trade failed for trader ${trade.traderAddress}: ${message}`).catch(() => {});
  }
}
