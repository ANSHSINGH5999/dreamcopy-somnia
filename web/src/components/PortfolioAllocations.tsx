"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import {
  COLLATERAL_TOKEN_ADDRESS,
  CONTRACTS_CONFIGURED,
  COPY_VAULT_ADDRESS,
  TRADER_REGISTRY_ADDRESS,
  copyVaultAbi,
  erc20Abi,
  traderRegistryAbi,
} from "@/lib/contracts";

// Design system's brand + status hues, cycled for pie segments.
const COLORS = ["#7C3AED", "#06B6D4", "#16A34A", "#D97706", "#DC2626", "#78716C", "#A78BFA", "#0EA5E9"];

interface Stake {
  traderId: bigint;
  label: string;
  stakeValue: bigint;
}

/// One row's on-chain reads: trader label + this follower's actual dollar
/// stake in that pool (shares * poolNav / totalShares — the real value,
/// not the declared allocation %, which is only intent until a
/// withdraw/deposit actually moves funds). Reports up via onResult once all
/// four reads have resolved.
function TraderStakeProbe({
  traderId,
  address,
  onResult,
}: {
  traderId: bigint;
  address: `0x${string}`;
  onResult: (stake: Stake) => void;
}) {
  const vault = COPY_VAULT_ADDRESS as `0x${string}`;
  const registry = TRADER_REGISTRY_ADDRESS as `0x${string}`;

  const { data: trader } = useReadContract({
    address: registry,
    abi: traderRegistryAbi,
    functionName: "getTrader",
    args: [traderId],
  });
  const { data: shares } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "sharesOf",
    args: [traderId, address],
  });
  const { data: totalShares } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "totalSharesOf",
    args: [traderId],
  });
  const { data: nav } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "poolNav",
    args: [traderId],
  });

  useEffect(() => {
    if (trader && shares !== undefined && totalShares !== undefined && nav !== undefined) {
      const stakeValue = totalShares === 0n ? 0n : (shares * nav) / totalShares;
      onResult({ traderId, label: trader.label, stakeValue });
    }
  }, [trader, shares, totalShares, nav, traderId, onResult]);

  return null;
}

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function PortfolioAllocations() {
  const { address, isConnected } = useAccount();
  const vault = COPY_VAULT_ADDRESS as `0x${string}`;
  const token = COLLATERAL_TOKEN_ADDRESS as `0x${string}`;

  const { data: allocData, refetch: refetchAllocations } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "getUserAllocations",
    args: address ? [address] : undefined,
    query: { enabled: CONTRACTS_CONFIGURED && Boolean(address) },
  });

  const { data: symbol } = useReadContract({
    address: token || undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: Boolean(token) },
  });
  const { data: decimals } = useReadContract({
    address: token || undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: Boolean(token) },
  });

  const traderIds = allocData?.[0] ?? [];
  const declaredPcts = allocData?.[1] ?? [];

  const [stakes, setStakes] = useState<Record<string, Stake>>({});
  const onStakeResult = useCallback((stake: Stake) => {
    setStakes((s) => ({ ...s, [stake.traderId.toString()]: stake }));
  }, []);

  const totalNav = useMemo(
    () => traderIds.reduce((sum, id) => sum + (stakes[id.toString()]?.stakeValue ?? 0n), 0n),
    [traderIds, stakes],
  );

  // Editable draft allocations for the rebalance form, seeded from the
  // on-chain declared values whenever the trader list changes.
  const [draftPcts, setDraftPcts] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    traderIds.forEach((id, i) => {
      next[id.toString()] = declaredPcts[i]?.toString() ?? "0";
    });
    setDraftPcts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocData]);

  const draftSum = useMemo(
    () => traderIds.reduce((sum, id) => sum + (Number(draftPcts[id.toString()]) || 0), 0),
    [traderIds, draftPcts],
  );

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: Boolean(txHash) },
  });

  useEffect(() => {
    if (isSuccess) void refetchAllocations();
  }, [isSuccess, refetchAllocations]);

  const saveAllocations = () => {
    if (draftSum > 100) return;
    writeContract({
      address: vault,
      abi: copyVaultAbi,
      functionName: "setAllocations",
      args: [traderIds, traderIds.map((id) => BigInt(draftPcts[id.toString()] || "0"))],
      // Explicit gas, scaled by array length — see StrategyCard.tsx's
      // comment on why leaving this unset triggers "rpc execution gas
      // limit exceeded" on Somnia.
      gas: 2_000_000n + BigInt(traderIds.length) * 1_000_000n,
    });
  };

  if (!CONTRACTS_CONFIGURED) return null;
  if (!isConnected || !address) return null;
  if (traderIds.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-stone-900">Allocation</h2>
        <p className="text-sm text-stone-500">
          You aren&apos;t following any traders yet — follow one on the Traders page to see your allocation here.
        </p>
      </div>
    );
  }

  const segments = traderIds.map((id, i) => {
    const stake = stakes[id.toString()];
    const pct = totalNav === 0n || !stake ? 0 : Number((stake.stakeValue * 10000n) / totalNav) / 100;
    return {
      traderId: id,
      label: stake?.label ?? `Trader #${id.toString()}`,
      stakeValue: stake?.stakeValue ?? 0n,
      pct,
      declaredPct: declaredPcts[i] ?? 0n,
      color: COLORS[i % COLORS.length],
    };
  });

  let cumulative = 0;
  const gradientStops = segments
    .map((s) => {
      const start = cumulative;
      cumulative += s.pct;
      return `${s.color} ${start}% ${cumulative}%`;
    })
    .join(", ");

  return (
    <div className="space-y-4">
      {traderIds.map((id) =>
        address ? (
          <TraderStakeProbe key={id.toString()} traderId={id} address={address} onResult={onStakeResult} />
        ) : null,
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-stone-900">Allocation</h2>
        <div className="text-sm text-stone-600">
          Total portfolio NAV:{" "}
          <span className="font-medium text-stone-900">
            {decimals !== undefined ? formatUnits(totalNav, decimals) : "…"} {symbol ?? ""}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div
          className="h-40 w-40 shrink-0 rounded-full"
          style={{ background: totalNav === 0n ? "#E7E5E4" : `conic-gradient(${gradientStops})` }}
          role="img"
          aria-label="Allocation split across followed traders"
        />

        <div className="flex-1 overflow-x-auto rounded-xl border border-stone-200 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium" />
                <th className="px-4 py-2 font-medium">Trader</th>
                <th className="px-4 py-2 font-medium">Actual stake</th>
                <th className="px-4 py-2 font-medium">Declared %</th>
                <th className="px-4 py-2 font-medium">New %</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.traderId.toString()} className="border-b border-stone-100 bg-white hover:bg-stone-50">
                  <td className="px-4 py-2">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: s.color }}
                      aria-hidden
                    />
                  </td>
                  <td className="px-4 py-2 text-stone-900">{s.label}</td>
                  <td className="px-4 py-2 text-stone-600">
                    {decimals !== undefined ? formatUnits(s.stakeValue, decimals) : "…"} ({s.pct.toFixed(1)}%)
                  </td>
                  <td className="px-4 py-2 text-stone-500">{s.declaredPct.toString()}%</td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={draftPcts[s.traderId.toString()] ?? "0"}
                      onChange={(e) =>
                        setDraftPcts((d) => ({ ...d, [s.traderId.toString()]: e.target.value }))
                      }
                      className="w-16 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={saveAllocations}
          disabled={draftSum > 100 || isPending || isConfirming}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
        >
          {isPending || isConfirming ? "Saving…" : "Rebalance"}
        </button>
        <span className={`text-xs ${draftSum > 100 ? "font-semibold text-red-600" : "text-stone-500"}`}>
          {draftSum}% of 100% allocated
        </span>
        {isSuccess && <span className="text-xs text-green-600">✓ Allocations updated</span>}
        {writeError && <span className="text-xs text-red-600">✕ {writeError.message.slice(0, 140)}</span>}
      </div>
      <p className="text-xs text-stone-400">
        Rebalance only updates your declared split — it doesn&apos;t move deposited funds between pools by itself.
        To match a new split exactly, withdraw from over-allocated pools and deposit into under-allocated ones on
        the Follow page (funds currently deployed in an open position aren&apos;t withdrawable until it closes — see
        docs/LIMITATIONS.md).
      </p>
    </div>
  );
}
