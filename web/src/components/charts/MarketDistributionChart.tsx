"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SUPABASE_CONFIGURED, supabase, type CopyTradeRow } from "@/lib/supabase";
import { marketSymbol } from "@/lib/marketDecimals";
import { ChartCard, ChartEmptyState, ChartSkeleton } from "./ChartCard";

interface MarketPoint {
  market: string;
  trades: number;
}

export function MarketDistributionChart() {
  const [data, setData] = useState<MarketPoint[] | null>(null);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase) return;
    let cancelled = false;

    supabase
      .from("copy_trades")
      .select("market")
      .eq("status", "success")
      .then(({ data: rows, error }) => {
        if (cancelled) return;
        if (error || !rows) {
          setData([]);
          return;
        }
        const counts = new Map<string, number>();
        for (const row of rows as Pick<CopyTradeRow, "market">[]) {
          const label = marketSymbol(row.market);
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
        setData(Array.from(counts.entries()).map(([market, trades]) => ({ market, trades })));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ChartCard title="Market Distribution">
      {!SUPABASE_CONFIGURED ? (
        <ChartEmptyState message="Supabase not configured." />
      ) : data === null ? (
        <ChartSkeleton />
      ) : data.length === 0 ? (
        <ChartEmptyState message="No trades yet" />
      ) : (
        <ResponsiveContainer width="100%" height={224}>
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
            <XAxis dataKey="market" stroke="#A8A29E" fontSize={12} tickLine={false} />
            <YAxis stroke="#A8A29E" fontSize={12} tickLine={false} width={30} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #E7E5E4", borderRadius: 8 }}
              labelStyle={{ color: "#1C1917" }}
              itemStyle={{ color: "#06B6D4" }}
            />
            <Bar dataKey="trades" fill="#06B6D4" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
