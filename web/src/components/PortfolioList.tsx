"use client";

import { useAccount, useReadContract } from "wagmi";
import { CONTRACTS_CONFIGURED, TRADER_REGISTRY_ADDRESS, traderRegistryAbi } from "@/lib/contracts";
import { PortfolioPosition } from "./PortfolioPosition";

export function PortfolioList() {
  const { address, isConnected } = useAccount();

  const { data: traderCount, isLoading } = useReadContract({
    address: CONTRACTS_CONFIGURED ? (TRADER_REGISTRY_ADDRESS as `0x${string}`) : undefined,
    abi: traderRegistryAbi,
    functionName: "traderCount",
    query: { enabled: CONTRACTS_CONFIGURED },
  });

  if (!CONTRACTS_CONFIGURED) {
    return <p className="text-sm text-stone-500">CopyVault not deployed — see banner above.</p>;
  }

  if (!isConnected || !address) {
    return <p className="text-sm text-stone-500">Connect your wallet to see your positions.</p>;
  }

  if (isLoading) {
    return <p className="text-sm text-stone-500">Reading positions from chain…</p>;
  }

  const count = traderCount ?? 0n;
  if (count === 0n) {
    return <p className="text-sm text-stone-500">No traders registered yet.</p>;
  }

  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

  return (
    <div className="space-y-4">
      {ids.map((id) => (
        <PortfolioPosition key={id.toString()} traderId={id} />
      ))}
      <p className="text-xs text-stone-400">
        Only pools where you hold shares are shown above. Zero-share pools are hidden.
      </p>
    </div>
  );
}
