"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SUPABASE_CONFIGURED, supabase, type CopyTradeRow } from "@/lib/supabase";
import { notionalUsdso } from "@/lib/marketDecimals";
import { ChartCard, ChartEmptyState, ChartSkeleton } from "./ChartCard";

const DAYS = 7;

interface DayPoint {
  day: string; // "Mon 12"
  volume: number;
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD, UTC-normalized key
  }
  return out;
}

function formatDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" });
}

export function VolumeOverTimeChart() {
  const [data, setData] = useState<DayPoint[] | null>(null);
  const [hasAnyRows, setHasAnyRows] = useState(false);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase) return;
    let cancelled = false;

    const since = new Date();
    since.setDate(since.getDate() - (DAYS - 1));
    since.setUTCHours(0, 0, 0, 0);

    supabase
      .from("copy_trades")
      .select("market, quantity, price, created_at")
      .eq("status", "success")
      .gte("created_at", since.toISOString())
      .then(({ data: rows, error }) => {
        if (cancelled) return;
        if (error || !rows) {
          setData([]);
          return;
        }

        const days = lastNDays(DAYS);
        const totals = Object.fromEntries(days.map((d) => [d, 0])) as Record<string, number>;

        for (const row of rows as Pick<CopyTradeRow, "market" | "quantity" | "price" | "created_at">[]) {
          const day = row.created_at.slice(0, 10);
          if (day in totals) {
            totals[day] += notionalUsdso(row.market, row.quantity, row.price);
          }
        }

        setHasAnyRows(rows.length > 0);
        setData(days.map((day) => ({ day: formatDayLabel(day), volume: Math.round(totals[day] * 100) / 100 })));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ChartCard title="Copy Volume Over Time">
      {!SUPABASE_CONFIGURED ? (
        <ChartEmptyState message="Supabase not configured." />
      ) : data === null ? (
        <ChartSkeleton />
      ) : !hasAnyRows ? (
        <ChartEmptyState message="No trades yet" />
      ) : (
        <ResponsiveContainer width="100%" height={224}>
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
            <XAxis dataKey="day" stroke="#A8A29E" fontSize={12} tickLine={false} />
            <YAxis stroke="#A8A29E" fontSize={12} tickLine={false} width={40} />
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #E7E5E4", borderRadius: 8 }}
              labelStyle={{ color: "#1C1917" }}
              itemStyle={{ color: "#7C3AED" }}
              formatter={(value) => [`${value} USDso`, "Volume"]}
            />
            <Line type="monotone" dataKey="volume" stroke="#7C3AED" strokeWidth={2} dot={{ fill: "#7C3AED", r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
