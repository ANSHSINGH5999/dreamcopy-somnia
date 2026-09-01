import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const SUPABASE_CONFIGURED = Boolean(url && publishableKey);

// Publishable key only — safe for the browser. RLS on copy_trades and
// notification_prefs grants this key SELECT only, or nothing at all (see
// docs/supabase_schema.sql) — writes there are exclusively via the secret
// key server-side. `simulations` is the one exception: RLS there also
// grants this key INSERT (starting a simulation is harmless — see that
// table's RLS comment for why), but never UPDATE.
export const supabase = SUPABASE_CONFIGURED ? createClient(url, publishableKey) : null;

export interface CopyTradeRow {
  id: string;
  trader_id: number;
  follower: string | null;
  market: `0x${string}`;
  is_bid: boolean;
  quantity: string;
  price: string;
  tx_hash: `0x${string}` | null;
  status: "success" | "failed" | "skipped";
  skip_reason: string | null;
  created_at: string;
}

export interface SimulationRow {
  id: string;
  wallet: string;
  trader_id: number;
  virtual_deposit: number;
  virtual_pnl: number;
  virtual_cost_basis: number;
  virtual_base_held: number;
  trade_count: number;
  started_at: string;
}

export interface WhaleAlertRow {
  id: string;
  trader_id: number;
  trader_label: string;
  market_symbol: string;
  is_bid: boolean;
  /// USDso notional (price*quantity/1e18), not raw base-token quantity —
  /// see indexer/src/whaleAlert.ts and docs/supabase_schema.sql.
  quantity: number;
  created_at: string;
}
