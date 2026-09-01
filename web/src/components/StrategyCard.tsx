"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { readContract, waitForTransactionReceipt } from "wagmi/actions";
import { COPY_VAULT_ADDRESS, TRADER_REGISTRY_ADDRESS, copyVaultAbi, traderRegistryAbi } from "@/lib/contracts";
import type { StrategyTemplate, TraderCandidate } from "@/lib/strategies";

type StepStatus = "pending" | "active" | "confirming" | "done" | "skipped" | "error";

const RISK_BADGE: Record<StrategyTemplate["riskLevel"], string> = {
  Low: "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  High: "bg-red-100 text-red-700",
};

export function StrategyCard({ template, traders }: { template: StrategyTemplate; traders: TraderCandidate[] }) {
  const router = useRouter();
  const wagmiConfig = useConfig();
  const { address, isConnected } = useAccount();
  const [showPreview, setShowPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [steps, setSteps] = useState<{ follow: StepStatus; allocate: StepStatus }>({
    follow: "pending",
    allocate: "pending",
  });
  const [error, setError] = useState<string | null>(null);

  const allocations = template.selectAllocations(traders);
  const { writeContractAsync } = useWriteContract();

  const apply = async () => {
    if (!address || allocations.length === 0) return;
    setApplying(true);
    setError(null);
    setSteps({ follow: "pending", allocate: "pending" });

    const traderIds = allocations.map((a) => a.traderId);
    const pcts = allocations.map((a) => BigInt(a.allocationPct));
    // Somnia testnet's gas estimation is unreliable for multi-element writes
    // (eth_estimateGas undershoots real cost, and leaving gas unset lets
    // viem fall back to a balance-derived default the RPC rejects outright
    // with "rpc execution gas limit exceeded") — pass an explicit, generous
    // ceiling that scales with the number of traders touched per call.
    const gasLimit = 2_000_000n + BigInt(traderIds.length) * 1_000_000n;

    try {
      // TraderRegistry.followMultiple reverts the whole batch with
      // AlreadyFollowing() if ANY id in it is already followed — it has no
      // per-id skip behavior. A strategy must be safely re-appliable (e.g.
      // after a manual follow, or re-running the same template), so filter
      // to only the traders this wallet doesn't already follow, same as
      // DepositModal's isFollowing check for the single-follow case.
      setSteps((s) => ({ ...s, follow: "active" }));
      const alreadyFollowing = await Promise.all(
        traderIds.map((id) =>
          readContract(wagmiConfig, {
            address: TRADER_REGISTRY_ADDRESS as `0x${string}`,
            abi: traderRegistryAbi,
            functionName: "isFollowing",
            args: [id, address],
          }),
        ),
      );
      const idsToFollow = traderIds.filter((_, i) => !alreadyFollowing[i]);

      if (idsToFollow.length === 0) {
        setSteps((s) => ({ ...s, follow: "skipped" }));
      } else {
        const followHash = await writeContractAsync({
          address: TRADER_REGISTRY_ADDRESS as `0x${string}`,
          abi: traderRegistryAbi,
          functionName: "followMultiple",
          args: [idsToFollow],
          gas: 2_000_000n + BigInt(idsToFollow.length) * 1_000_000n,
        });
        setSteps((s) => ({ ...s, follow: "confirming" }));
        await waitForTransactionReceipt(wagmiConfig, { hash: followHash });
        setSteps((s) => ({ ...s, follow: "done" }));
      }

      setSteps((s) => ({ ...s, allocate: "active" }));
      const allocHash = await writeContractAsync({
        address: COPY_VAULT_ADDRESS as `0x${string}`,
        abi: copyVaultAbi,
        functionName: "setAllocations",
        args: [traderIds, pcts],
        gas: gasLimit,
      });
      setSteps((s) => ({ ...s, allocate: "confirming" }));
      await waitForTransactionReceipt(wagmiConfig, { hash: allocHash });
      setSteps((s) => ({ ...s, allocate: "done" }));

      router.push("/portfolio");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setSteps((s) => ({
        follow: s.follow === "active" || s.follow === "confirming" ? "error" : s.follow,
        allocate: s.allocate === "active" || s.allocate === "confirming" ? "error" : s.allocate,
      }));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-stone-900">{template.name}</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${RISK_BADGE[template.riskLevel]}`}>
          {template.riskLevel} risk
        </span>
      </div>
      <p className="mt-2 text-sm text-stone-600">{template.description}</p>
      <p className="mt-3 text-xs text-stone-500">
        Expected: {allocations.length} trader{allocations.length === 1 ? "" : "s"}, targets{" "}
        {template.targetMaxAllocationPct}% max allocation / {template.targetStopLossPct}% stop-loss per pool
        (pool-wide settings — see this trader&apos;s Risk guardrails panel on the Follow page for the actual
        current values; a strategy can&apos;t set those for you, only the pool owner can).
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-50"
        >
          {showPreview ? "Hide preview" : "Preview"}
        </button>
        <button
          type="button"
          onClick={apply}
          disabled={!isConnected || applying || allocations.length === 0}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
        >
          {applying ? "Applying…" : "Apply"}
        </button>
      </div>

      {showPreview && (
        <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3">
          {allocations.length === 0 ? (
            <p className="text-xs text-stone-500">No active traders currently match this strategy.</p>
          ) : (
            <ul className="space-y-1 text-xs text-stone-600">
              {allocations.map((a) => (
                <li key={a.traderId.toString()} className="flex justify-between">
                  <span>{a.label}</span>
                  <span className="text-violet-700">{a.allocationPct}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {applying && (
        <div className="mt-4 space-y-2 text-xs">
          <StepRow label="Follow traders (TraderRegistry.followMultiple)" status={steps.follow} />
          <StepRow label="Set allocations (CopyVault.setAllocations)" status={steps.allocate} />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">✕ {error}</p>}
      {!isConnected && <p className="mt-2 text-xs text-stone-400">Connect your wallet to apply a strategy.</p>}
    </div>
  );
}

function StepRow({ label, status }: { label: string; status: StepStatus }) {
  const icon =
    status === "done"
      ? "✓"
      : status === "error"
        ? "✕"
        : status === "skipped"
          ? "–"
          : status === "confirming" || status === "active"
            ? "◐"
            : "○";
  const color =
    status === "done"
      ? "text-green-600"
      : status === "error"
        ? "text-red-600"
        : status === "skipped"
          ? "text-stone-400"
          : status === "confirming" || status === "active"
            ? "animate-pulse text-violet-600"
            : "text-stone-300";
  return (
    <div className="flex items-center gap-2">
      <span className={color}>{icon}</span>
      <div>
        <span className="text-stone-700">{label}</span>
        {status === "skipped" && (
          <div className="text-xs text-stone-400">Already following every trader here — skipped.</div>
        )}
      </div>
    </div>
  );
}
