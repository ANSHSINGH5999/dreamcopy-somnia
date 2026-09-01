import { NextResponse } from "next/server";
import { SUPABASE_ADMIN_CONFIGURED, supabaseAdmin } from "@/lib/supabaseAdmin";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface NotificationPrefsPayload {
  wallet: string;
  telegram_chat_id: string | null;
  notify_on_copy: boolean;
  notify_on_stop_loss: boolean;
  notify_on_referral: boolean;
  min_trade_size: number;
}

const DEFAULTS: Omit<NotificationPrefsPayload, "wallet"> = {
  telegram_chat_id: null,
  notify_on_copy: true,
  notify_on_stop_loss: true,
  notify_on_referral: true,
  min_trade_size: 0,
};

/// GET /api/notify/prefs?wallet=0x... — reads one wallet's saved prefs.
/// Server-side only: see docs/supabase_schema.sql's notification_prefs
/// comment for why this doesn't just let the browser query Supabase
/// directly with the publishable key.
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.toLowerCase() ?? "";
  if (!ADDRESS_RE.test(wallet)) {
    return NextResponse.json({ error: "invalid wallet address" }, { status: 400 });
  }
  if (!SUPABASE_ADMIN_CONFIGURED || !supabaseAdmin) {
    return NextResponse.json({ wallet, ...DEFAULTS });
  }

  const { data, error } = await supabaseAdmin
    .from("notification_prefs")
    .select("telegram_chat_id, notify_on_copy, notify_on_stop_loss, notify_on_referral, min_trade_size")
    .eq("wallet", wallet)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ wallet, ...(data ?? DEFAULTS) });
}

/// POST /api/notify/prefs — upserts the caller-supplied wallet's prefs.
/// NOTE: this trusts the `wallet` field in the request body — there is no
/// wallet-signature auth anywhere in this app binding a connected address
/// to this call (deposits/follows get that guarantee for free because
/// they're real signed on-chain transactions; this is a plain HTTP POST).
/// Worst case a malicious caller overwrites another wallet's notification
/// settings (annoying, not fund-threatening — no balances or keys live
/// here). Documented rather than silently assumed; a real fix would need a
/// SIWE-style signed-message flow, out of scope for this feature.
export async function POST(req: Request) {
  if (!SUPABASE_ADMIN_CONFIGURED || !supabaseAdmin) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  let body: Partial<NotificationPrefsPayload>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const wallet = body.wallet?.toLowerCase() ?? "";
  if (!ADDRESS_RE.test(wallet)) {
    return NextResponse.json({ error: "invalid wallet address" }, { status: 400 });
  }
  if (body.telegram_chat_id !== null && body.telegram_chat_id !== undefined && typeof body.telegram_chat_id !== "string") {
    return NextResponse.json({ error: "telegram_chat_id must be a string or null" }, { status: 400 });
  }
  const minTradeSize = Number(body.min_trade_size ?? 0);
  if (!Number.isFinite(minTradeSize) || minTradeSize < 0) {
    return NextResponse.json({ error: "min_trade_size must be a non-negative number" }, { status: 400 });
  }

  const row = {
    wallet,
    telegram_chat_id: body.telegram_chat_id || null,
    notify_on_copy: Boolean(body.notify_on_copy ?? DEFAULTS.notify_on_copy),
    notify_on_stop_loss: Boolean(body.notify_on_stop_loss ?? DEFAULTS.notify_on_stop_loss),
    notify_on_referral: Boolean(body.notify_on_referral ?? DEFAULTS.notify_on_referral),
    min_trade_size: minTradeSize,
  };

  const { error } = await supabaseAdmin.from("notification_prefs").upsert(row, { onConflict: "wallet" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
