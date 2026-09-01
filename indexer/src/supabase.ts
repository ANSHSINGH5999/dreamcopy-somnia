import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

const client =
  config.supabaseUrl && config.supabaseSecretKey
    ? createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false } })
    : null;

if (!client) {
  console.warn("[supabase] SUPABASE_URL / SUPABASE_SECRET_KEY not set — copy_trades logging disabled");
}

export interface CopyTradeRow {
  trader_id: number;
  /// Deliberately always null: CopyVault.executeCopy has no follower
  /// parameter — it trades the pool's entire balance for a traderId in one
  /// call, affecting every current follower proportionally. There is no
  /// single "the follower" for a given row. See docs/supabase_schema.sql.
  follower: null;
  market: string;
  is_bid: boolean;
  quantity: string;
  price: string;
  tx_hash: string | null;
  status: "success" | "failed" | "skipped";
  skip_reason: string | null;
}

/// Logs one executeCopy attempt (success, on-chain failure, or a pre-flight
/// skip). Never throws — a logging failure must never affect a trade result
/// or take down the indexer, matching every other side-effect in this repo
/// (see telegram.ts).
export async function insertCopyTrade(row: CopyTradeRow): Promise<void> {
  if (!client) return;
  try {
    const { error } = await client.from("copy_trades").insert(row);
    if (error) {
      console.error("[supabase] insert failed:", error.message);
    }
  } catch (err) {
    console.error("[supabase] insert threw:", err);
  }
}

export interface NotificationPrefs {
  telegram_chat_id: string | null;
  notify_on_copy: boolean;
  notify_on_stop_loss: boolean;
  notify_on_referral: boolean;
  min_trade_size: number;
}

const DEFAULT_PREFS: NotificationPrefs = {
  telegram_chat_id: null,
  notify_on_copy: true,
  notify_on_stop_loss: true,
  notify_on_referral: true,
  min_trade_size: 0,
};

export interface SimulationRow {
  id: string;
  wallet: string;
  trader_id: number;
  virtual_deposit: number;
  virtual_pnl: number;
  virtual_cost_basis: number;
  virtual_base_held: number;
  trade_count: number;
}

/// All simulations currently tracking traderId — see
/// indexer/src/simulation.ts, which updates each one as that trader's real
/// fills come in.
export async function getSimulationsForTrader(traderId: number): Promise<SimulationRow[]> {
  if (!client) return [];
  try {
    const { data, error } = await client.from("simulations").select("*").eq("trader_id", traderId);
    if (error || !data) return [];
    return data as SimulationRow[];
  } catch (err) {
    console.error("[supabase] getSimulationsForTrader threw:", err);
    return [];
  }
}

export async function updateSimulation(
  id: string,
  fields: Pick<SimulationRow, "virtual_pnl" | "virtual_cost_basis" | "virtual_base_held" | "trade_count">,
): Promise<void> {
  if (!client) return;
  try {
    const { error } = await client.from("simulations").update(fields).eq("id", id);
    if (error) console.error("[supabase] updateSimulation failed:", error.message);
  } catch (err) {
    console.error("[supabase] updateSimulation threw:", err);
  }
}

export interface WhaleAlertRow {
  trader_id: number;
  trader_label: string;
  market_symbol: string;
  is_bid: boolean;
  /// USDso notional of the fill (price*quantity/1e18, same convention as
  /// simulation.ts) — not the raw base-token quantity, matching what the
  /// Telegram message and the frontend banner both display. See
  /// whaleAlert.ts.
  quantity: number;
}

/// Logs one whale-sized fill for the public whale_alerts feed (see
/// web/src/components/WhaleAlertBanner.tsx, which reads this table via
/// Supabase Realtime). Never throws — same "side effect must never affect
/// the trade" rule as insertCopyTrade.
export async function insertWhaleAlert(row: WhaleAlertRow): Promise<void> {
  if (!client) return;
  try {
    const { error } = await client.from("whale_alerts").insert(row);
    if (error) {
      console.error("[supabase] whale_alerts insert failed:", error.message);
    }
  } catch (err) {
    console.error("[supabase] whale_alerts insert threw:", err);
  }
}

/// Reads one wallet's saved notification preferences (see
/// web/src/app/api/notify/prefs/route.ts for how they're written). No row
/// yet -> the column defaults (opted in, no chat id, so nothing actually
/// sends until the wallet configures one via /settings). Never throws — the
/// same default-safe fallback is used on any read error.
export async function getNotificationPrefs(wallet: string): Promise<NotificationPrefs> {
  if (!client) return DEFAULT_PREFS;
  try {
    const { data, error } = await client
      .from("notification_prefs")
      .select("telegram_chat_id, notify_on_copy, notify_on_stop_loss, notify_on_referral, min_trade_size")
      .eq("wallet", wallet.toLowerCase())
      .maybeSingle();
    if (error || !data) return DEFAULT_PREFS;
    return data as NotificationPrefs;
  } catch (err) {
    console.error("[supabase] getNotificationPrefs threw:", err);
    return DEFAULT_PREFS;
  }
}
