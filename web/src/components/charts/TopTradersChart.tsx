"use client";

import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReadContract } from "wagmi";
import { SUPABASE_CONFIGURED, supabase, type CopyTradeRow } from "@/lib/supabase";
import { notionalUsdso } from "@/lib/marketDecimals";
import { TRADER_REGISTRY_ADDRESS, traderRegistryAbi } from "@/lib/contracts";
import { ChartCard, ChartEmptyState, ChartSkeleton } from "./ChartCard";

interface TraderVolume {
  traderId: number;
  volume: number;
}

function TraderLabelProbe({ traderId, onLabel }: { traderId: number; onLabel: (id: number, label: string) => void }) {
  const { data: trader } = useReadContract({
    address: TRADER_REGISTRY_ADDRESS as `0x${string}`,
    abi: traderRegistryAbi,
    functionName: "getTrader",
    args: [BigInt(traderId)],
  });

  useEffect(() => {
    if (trader) onLabel(traderId, trader.label);
  }, [trader, traderId, onLabel]);

  return null;
}

export function TopTradersChart() {
  const [ranked, setRanked] = useState<TraderVolume[] | null>(null);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase) return;
    let cancelled = false;

    supabase
      .from("copy_trades")
      .select("trader_id, market, quantity, price")
      .eq("status", "success")
      .then(({ data: rows, error }) => {
        if (cancelled) return;
        if (error || !rows) {
          setRanked([]);
          return;
        }
        const totals = new Map<number, number>();
        for (const row of rows as Pick<CopyTradeRow, "trader_id" | "market" | "quantity" | "price">[]) {
          const notional = notionalUsdso(row.market, row.quantity, row.price);
          totals.set(row.trader_id, (totals.get(row.trader_id) ?? 0) + notional);
        }
        setRanked(
          Array.from(totals.entries())
            .map(([traderId, volume]) => ({ traderId, volume: Math.round(volume * 100) / 100 }))
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 5),
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const [labels, setLabels] = useState<Record<number, string>>({});
  const onLabel = useCallback(
    (id: number, label: string) => setLabels((l) => (l[id] === label ? l : { ...l, [id]: label })),
    [],
  );

  const chartData = (ranked ?? []).map((r) => ({
    trader: labels[r.traderId] ?? `#${r.traderId}`,
    volume: r.volume,
  }));

  return (
    <ChartCard title="Top Traders by Volume">
      {ranked && ranked.length > 0 && (
        <>
          {ranked.map((r) => (
            <TraderLabelProbe key={r.traderId} traderId={r.traderId} onLabel={onLabel} />
          ))}
        </>
      )}

      {!SUPABASE_CONFIGURED ? (
        <ChartEmptyState message="Supabase not configured." />
      ) : ranked === null ? (
        <ChartSkeleton />
      ) : ranked.length === 0 ? (
        <ChartEmptyState message="No trades yet" />
      ) : (
        <ResponsiveContainer width="100%" height={224}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" horizontal={false} />
            <XAxis type="number" stroke="#A8A29E" fontSize={12} tickLine={false} />
            <YAxis
              type="category"
              dataKey="trader"
              stroke="#A8A29E"
              fontSize={12}
              tickLine={false}
              width={90}
            />
            <Tooltip
              contentStyle={{ background: "#fff", border: "1px solid #E7E5E4", borderRadius: 8 }}
              labelStyle={{ color: "#1C1917" }}
              itemStyle={{ color: "#7C3AED" }}
              formatter={(value) => [`${value} USDso`, "Volume"]}
            />
            <Bar dataKey="volume" fill="#7C3AED" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
