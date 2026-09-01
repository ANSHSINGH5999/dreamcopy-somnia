"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import { CONTRACTS_CONFIGURED, TRADER_REGISTRY_ADDRESS, traderRegistryAbi } from "@/lib/contracts";
import { SUPABASE_CONFIGURED, supabase, type CopyTradeRow } from "@/lib/supabase";

const EXPLORER_TX_BASE = "https://shannon-explorer.somnia.network/tx";
const MAX_ITEMS = 20;

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const ROW_STYLE_BY_STATUS: Record<CopyTradeRow["status"], string> = {
  success: "border-l-4 border-green-500 bg-green-50",
  failed: "border-l-4 border-red-500 bg-red-50",
  skipped: "border-l-4 border-stone-300 bg-stone-50",
};

/// copy_trades only stores trader_id (a number) — resolves it to the real
/// label via TraderRegistry.getTrader, same pattern used elsewhere in this
/// app (e.g. PortfolioAllocations' TraderStakeProbe).
function TraderLabelProbe({ traderId, onLabel }: { traderId: bigint; onLabel: (id: number, label: string) => void }) {
  const { data: trader } = useReadContract({
    address: TRADER_REGISTRY_ADDRESS as `0x${string}`,
    abi: traderRegistryAbi,
    functionName: "getTrader",
    args: [traderId],
  });

  useEffect(() => {
    if (trader) onLabel(Number(traderId), trader.label);
  }, [trader, traderId, onLabel]);

  return null;
}

export function ActivityFeed() {
  const [items, setItems] = useState<CopyTradeRow[] | null>(null);
  const [, setTick] = useState(0); // forces a re-render every 30s so "time ago" stays fresh

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase) return;
    let cancelled = false;

    supabase
      .from("copy_trades")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS)
      .then(({ data, error }) => {
        if (cancelled) return;
        setItems(!error && data ? (data as CopyTradeRow[]) : []);
      });

    const channel = supabase
      .channel("copy_trades_feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "copy_trades" },
        (payload) => {
          setItems((prev) => [payload.new as CopyTradeRow, ...(prev ?? [])].slice(0, MAX_ITEMS));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase?.removeChannel(channel);
    };
  }, []);

  const uniqueTraderIds = useMemo(
    () => Array.from(new Set((items ?? []).map((i) => i.trader_id))).map((id) => BigInt(id)),
    [items],
  );

  const [labels, setLabels] = useState<Record<number, string>>({});
  const onLabel = useCallback(
    (id: number, label: string) => setLabels((l) => (l[id] === label ? l : { ...l, [id]: label })),
    [],
  );

  if (!SUPABASE_CONFIGURED) {
    return <p className="text-sm text-stone-500">Live activity isn&apos;t configured (Supabase env vars unset).</p>;
  }

  if (items === null) {
    return <p className="text-sm text-stone-500">Loading activity…</p>;
  }

  if (items.length === 0) {
    return <p className="text-sm text-stone-500">No copy trades yet — activity will appear here in real time.</p>;
  }

  return (
    <div className="space-y-2">
      {CONTRACTS_CONFIGURED &&
        uniqueTraderIds.map((id) => <TraderLabelProbe key={id.toString()} traderId={id} onLabel={onLabel} />)}

      {items.map((item) => (
        <div
          key={item.id}
          className={`flex flex-wrap items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${ROW_STYLE_BY_STATUS[item.status]}`}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs text-stone-400">{timeAgo(item.created_at)}</span>
            <span className="text-stone-800">{labels[item.trader_id] ?? `Trader #${item.trader_id}`}</span>
            <span className="font-mono text-xs text-stone-500">{short(item.market)}</span>
            {item.is_bid ? (
              <span className="rounded-full bg-violet-600 px-2 py-0.5 text-xs font-semibold text-white">BUY</span>
            ) : (
              <span className="rounded-full border border-violet-300 bg-white px-2 py-0.5 text-xs text-violet-700">
                SELL
              </span>
            )}
            <span className="font-mono text-xs text-stone-600">{item.quantity}</span>
            {item.status === "success" && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                success
              </span>
            )}
            {item.status === "failed" && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                ⚠ failed
              </span>
            )}
            {item.status === "skipped" && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">skipped</span>
            )}
          </div>
          {item.tx_hash ? (
            <a
              href={`${EXPLORER_TX_BASE}/${item.tx_hash}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-xs text-violet-700 hover:underline"
            >
              {short(item.tx_hash)} ↗
            </a>
          ) : (
            <span className="shrink-0 text-xs text-stone-300">—</span>
          )}
        </div>
      ))}
    </div>
  );
}
