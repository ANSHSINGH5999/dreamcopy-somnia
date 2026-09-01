"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import { StrategyCard } from "@/components/StrategyCard";
import { CONTRACTS_CONFIGURED, TRADER_REGISTRY_ADDRESS, traderRegistryAbi } from "@/lib/contracts";
import { STRATEGY_TEMPLATES, type TraderCandidate } from "@/lib/strategies";

function TraderProbe({ traderId, onResult }: { traderId: bigint; onResult: (row: TraderCandidate) => void }) {
  const registry = TRADER_REGISTRY_ADDRESS as `0x${string}`;

  const { data: trader } = useReadContract({
    address: registry,
    abi: traderRegistryAbi,
    functionName: "getTrader",
    args: [traderId],
  });
  const { data: winRate } = useReadContract({
    address: registry,
    abi: traderRegistryAbi,
    functionName: "getWinRate",
    args: [traderId],
  });

  useEffect(() => {
    if (trader && winRate !== undefined) {
      onResult({
        traderId,
        label: trader.label,
        active: trader.active,
        followerCount: trader.followerCount,
        winRate: Number(winRate),
      });
    }
  }, [trader, winRate, traderId, onResult]);

  return null;
}

export default function StrategiesPage() {
  const { data: traderCount } = useReadContract({
    address: CONTRACTS_CONFIGURED ? (TRADER_REGISTRY_ADDRESS as `0x${string}`) : undefined,
    abi: traderRegistryAbi,
    functionName: "traderCount",
    query: { enabled: CONTRACTS_CONFIGURED },
  });

  const count = traderCount ?? 0n;
  const ids = useMemo(() => Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1)), [count]);

  const [traders, setTraders] = useState<Record<string, TraderCandidate>>({});
  const onResult = useCallback(
    (row: TraderCandidate) => setTraders((t) => ({ ...t, [row.traderId.toString()]: row })),
    [],
  );
  const traderList = ids.map((id) => traders[id.toString()]).filter((t): t is TraderCandidate => Boolean(t));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold text-stone-900">Strategies</h1>
        <p className="mt-2 text-sm text-stone-500">
          One-click templates that call <code className="rounded bg-stone-100 px-1">followMultiple</code> +{" "}
          <code className="rounded bg-stone-100 px-1">setAllocations</code> for you. These don&apos;t deposit any
          funds by themselves — follow up on the{" "}
          <a href="/follow" className="text-violet-700 hover:underline">
            Follow
          </a>{" "}
          page to actually fund a pool.
        </p>
      </div>

      {!CONTRACTS_CONFIGURED ? (
        <p className="text-sm text-stone-500">Contracts not deployed — see banner above.</p>
      ) : (
        <>
          {ids.map((id) => (
            <TraderProbe key={id.toString()} traderId={id} onResult={onResult} />
          ))}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {STRATEGY_TEMPLATES.map((template) => (
              <StrategyCard key={template.id} template={template} traders={traderList} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
