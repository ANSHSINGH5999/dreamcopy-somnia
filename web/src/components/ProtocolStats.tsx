"use client";

import { useReadContract } from "wagmi";
import { CONTRACTS_CONFIGURED, TRADER_REGISTRY_ADDRESS, traderRegistryAbi } from "@/lib/contracts";

export function ProtocolStats() {
  const { data: traderCount, isLoading } = useReadContract({
    address: CONTRACTS_CONFIGURED ? (TRADER_REGISTRY_ADDRESS as `0x${string}`) : undefined,
    abi: traderRegistryAbi,
    functionName: "traderCount",
    query: { enabled: CONTRACTS_CONFIGURED },
  });

  if (!CONTRACTS_CONFIGURED) return null;

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-stone-500">Registered traders on-chain</p>
        <p className="mt-1 text-2xl font-semibold text-violet-700">
          {isLoading ? "…" : (traderCount?.toString() ?? "0")}
        </p>
      </div>
      <div className="rounded-xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-stone-500">TraderRegistry</p>
        <p className="mt-1 truncate font-mono text-xs text-stone-600">{TRADER_REGISTRY_ADDRESS}</p>
      </div>
    </section>
  );
}
