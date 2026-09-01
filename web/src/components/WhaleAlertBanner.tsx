"use client";

import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED, supabase, type WhaleAlertRow } from "@/lib/supabase";

const AUTO_HIDE_MS = 10_000;
const MAX_AGE_MS = 5 * 60 * 1000;

function alertText(a: WhaleAlertRow): string {
  const side = a.is_bid ? "BUY" : "SELL";
  return `🐋 ${a.trader_label} ${a.market_symbol} ${side} ${a.quantity.toFixed(2)} USDso`;
}

export function WhaleAlertBanner() {
  const [alert, setAlert] = useState<WhaleAlertRow | null>(null);
  const [visible, setVisible] = useState(false);

  // On mount, show the most recent alert if it's still fresh.
  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase) return;
    let cancelled = false;

    supabase
      .from("whale_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const row = data as WhaleAlertRow;
        if (Date.now() - new Date(row.created_at).getTime() < MAX_AGE_MS) {
          setAlert(row);
          setVisible(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to new whale alerts as they land.
  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase) return;

    const channel = supabase
      .channel("whale_alerts_feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whale_alerts" },
        (payload) => {
          setAlert(payload.new as WhaleAlertRow);
          setVisible(true);
        },
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [visible, alert?.id]);

  if (!visible || !alert) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 py-2">
      <div className="flex items-center gap-3 rounded-full bg-violet-600 px-4 py-2 text-sm text-white shadow-md">
        <span>{alertText(alert)}</span>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss whale alert"
          className="text-white/70 transition hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
