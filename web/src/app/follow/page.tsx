"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { NotDeployedBanner } from "@/components/NotDeployedBanner";
import { DepositModal } from "@/components/DepositModal";
import { RiskParamsPanel } from "@/components/RiskParamsPanel";
import { CONTRACTS_CONFIGURED, TRADER_REGISTRY_ADDRESS, traderRegistryAbi } from "@/lib/contracts";

function TraderPickerRow({
  traderId,
  onSelect,
}: {
  traderId: bigint;
  onSelect: (traderId: bigint, label: string) => void;
}) {
  const { data: trader } = useReadContract({
    address: TRADER_REGISTRY_ADDRESS as `0x${string}`,
    abi: traderRegistryAbi,
    functionName: "getTrader",
    args: [traderId],
  });

  if (!trader) {
    return (
      <tr className="border-b border-stone-100 bg-white">
        <td className="px-4 py-3 text-stone-400" colSpan={4}>
          Loading trader #{traderId.toString()}…
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-stone-100 bg-white hover:bg-stone-50">
      <td className="px-4 py-3 font-medium text-stone-900">{trader.label}</td>
      <td className="px-4 py-3 text-stone-600">
        {trader.active ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">active</span>
        ) : (
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">inactive</span>
        )}
      </td>
      <td className="px-4 py-3 text-stone-600">{trader.followerCount.toString()}</td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          disabled={!trader.active}
          onClick={() => onSelect(traderId, trader.label)}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
        >
          Follow + Deposit
        </button>
      </td>
    </tr>
  );
}

function TraderRiskRow({ traderId }: { traderId: bigint }) {
  const { data: trader } = useReadContract({
    address: TRADER_REGISTRY_ADDRESS as `0x${string}`,
    abi: traderRegistryAbi,
    functionName: "getTrader",
    args: [traderId],
  });

  if (!trader) return null;
  return <RiskParamsPanel traderId={traderId} traderLabel={trader.label} />;
}

export default function FollowPage() {
  const { isConnected } = useAccount();
  const [selected, setSelected] = useState<{ id: bigint; label: string } | null>(null);

  const { data: traderCount } = useReadContract({
    address: CONTRACTS_CONFIGURED ? (TRADER_REGISTRY_ADDRESS as `0x${string}`) : undefined,
    abi: traderRegistryAbi,
    functionName: "traderCount",
    query: { enabled: CONTRACTS_CONFIGURED },
  });

  const count = traderCount ?? 0n;
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold text-stone-900">Follow &amp; fund</h1>
        <p className="mt-1 text-sm text-stone-500">
          Pick a trader below. Follow + Deposit walks through approving{" "}
          <code className="rounded bg-stone-100 px-1">USDso</code>, following on TraderRegistry, and depositing into
          CopyVault as one guided sequence — deposits are share-based and pooled per trader, so your exposure to
          their fills is automatically proportional to your share of the pool. See{" "}
          <code className="rounded bg-stone-100 px-1">docs/LIMITATIONS.md</code> for how NAV/shares are priced (no
          price oracle — realized P&amp;L only).
        </p>
      </div>
      <NotDeployedBanner />

      {!CONTRACTS_CONFIGURED ? null : count === 0n ? (
        <p className="text-sm text-stone-500">No traders registered yet — register one on the Traders page.</p>
      ) : !isConnected ? (
        <p className="text-sm text-stone-500">Connect your wallet to follow and deposit.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Followers</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {ids.map((id) => (
                <TraderPickerRow
                  key={id.toString()}
                  traderId={id}
                  onSelect={(traderId, label) => setSelected({ id: traderId, label })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {CONTRACTS_CONFIGURED && count > 0n && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-stone-900">Risk guardrails</h2>
          {ids.map((id) => (
            <TraderRiskRow key={id.toString()} traderId={id} />
          ))}
        </div>
      )}

      <DepositModal
        traderId={selected?.id ?? 0n}
        traderLabel={selected?.label ?? ""}
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
