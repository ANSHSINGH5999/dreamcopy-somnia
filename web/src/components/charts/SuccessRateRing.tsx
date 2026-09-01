"use client";

import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED, supabase } from "@/lib/supabase";
import { ChartCard, ChartEmptyState, ChartSkeleton } from "./ChartCard";

interface Counts {
  success: number;
  failed: number;
}

/// Ring/text color band using the design system's status colors: green for
/// healthy, amber for marginal, red for poor.
function bandFor(pct: number): { ring: string; text: string } {
  if (pct > 80) return { ring: "#16A34A", text: "text-green-600" };
  if (pct >= 50) return { ring: "#D97706", text: "text-amber-600" };
  return { ring: "#DC2626", text: "text-red-600" };
}

export function SuccessRateRing() {
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase) return;
    let cancelled = false;

    Promise.all([
      supabase.from("copy_trades").select("id", { count: "exact", head: true }).eq("status", "success"),
      supabase.from("copy_trades").select("id", { count: "exact", head: true }).eq("status", "failed"),
    ]).then(([successRes, failedRes]) => {
      if (cancelled) return;
      setCounts({ success: successRes.count ?? 0, failed: failedRes.count ?? 0 });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ChartCard title="Success Rate">
      {!SUPABASE_CONFIGURED ? (
        <ChartEmptyState message="Supabase not configured." />
      ) : counts === null ? (
        <ChartSkeleton />
      ) : counts.success + counts.failed === 0 ? (
        <ChartEmptyState message="No trades yet" />
      ) : (
        <RingDisplay counts={counts} />
      )}
    </ChartCard>
  );
}

function RingDisplay({ counts }: { counts: Counts }) {
  const total = counts.success + counts.failed;
  const pct = total === 0 ? 0 : (counts.success / total) * 100;
  const band = bandFor(pct);
  const pctRounded = Math.round(pct * 10) / 10;

  return (
    <div className="flex h-56 flex-col items-center justify-center gap-3">
      <div
        className="relative flex h-36 w-36 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${band.ring} ${pct}%, #E7E5E4 ${pct}% 100%)` }}
      >
        <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white">
          <span className={`text-3xl font-bold ${band.text}`}>{pctRounded}%</span>
        </div>
      </div>
      <p className="text-sm text-stone-500">
        {counts.success} / {total} successful
      </p>
    </div>
  );
}
