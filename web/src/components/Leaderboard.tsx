"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { CONTRACTS_CONFIGURED, TRADER_REGISTRY_ADDRESS, traderRegistryAbi } from "@/lib/contracts";

interface TraderRow {
  traderId: bigint;
  wallet: `0x${string}`;
  label: string;
  active: boolean;
  followerCount: bigint;
  winRate: number;
  totalTrades: bigint;
  realizedPnL: bigint;
  totalVolume: bigint;
  bestTrade: bigint;
}

type SortKey = "pnl" | "followers" | "winRate";

function formatPnL(pnl: bigint): string {
  const abs = pnl < 0n ? -pnl : pnl;
  const whole = abs / 10n ** 18n;
  const sign = pnl < 0n ? "-" : "+";
  return `${sign}${whole.toString()}`;
}

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/// Badge tiers are a pure derived view — no extra on-chain storage, computed
/// straight from getWinRate + totalTrades (see
/// TraderRegistry.performance's doc comment).
function badgeFor(winRate: number, totalTrades: bigint): { icon: string; label: string } | null {
  if (winRate >= 60 && totalTrades >= 10n) return { icon: "🏆", label: "Verified" };
  if (winRate >= 50 && totalTrades >= 5n) return { icon: "⭐", label: "Rising" };
  return null;
}

/// Fetches one trader's on-chain record (profile + win-rate/badge data) and
/// reports it up to the parent so the full list can be collected and sorted
/// before rendering. No Supabase involved — pure on-chain reads, per spec.
function TraderProbe({ traderId, onResult }: { traderId: bigint; onResult: (row: TraderRow) => void }) {
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
  const { data: performance } = useReadContract({
    address: registry,
    abi: traderRegistryAbi,
    functionName: "performance",
    args: [traderId],
  });
  const { data: pnl } = useReadContract({
    address: registry,
    abi: traderRegistryAbi,
    functionName: "traderPnL",
    args: [traderId],
  });

  useEffect(() => {
    if (trader && winRate !== undefined && performance && pnl) {
      onResult({
        traderId,
        wallet: trader.wallet,
        label: trader.label,
        active: trader.active,
        followerCount: trader.followerCount,
        winRate: Number(winRate),
        totalTrades: performance[0],
        realizedPnL: pnl[0],
        totalVolume: pnl[1],
        bestTrade: pnl[2],
      });
    }
  }, [trader, winRate, performance, pnl, traderId, onResult]);

  return null;
}

function FollowButton({ traderId, active }: { traderId: bigint; active: boolean }) {
  const { address } = useAccount();
  const registry = TRADER_REGISTRY_ADDRESS as `0x${string}`;

  const { data: isFollowing, refetch: refetchFollowing } = useReadContract({
    address: registry,
    abi: traderRegistryAbi,
    functionName: "isFollowing",
    args: address ? [traderId, address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: Boolean(txHash) },
  });

  if (!address) {
    return <span className="text-xs text-stone-400">Connect wallet</span>;
  }

  const busy = isPending || isConfirming;

  // Follow/unfollow is called directly by the connected wallet — msg.sender
  // on TraderRegistry is the real user, never routed through another
  // contract (see TraderRegistry.followMultiple's doc comment for why that
  // distinction matters).
  const toggle = () => {
    writeContract(
      {
        address: registry,
        abi: traderRegistryAbi,
        functionName: isFollowing ? "unfollow" : "follow",
        args: [traderId],
        // Explicit gas — see StrategyCard.tsx's comment on why leaving this
        // unset triggers "rpc execution gas limit exceeded" on Somnia.
        gas: 3_000_000n,
      },
      { onSuccess: () => void refetchFollowing() },
    );
  };

  return (
    <button
      type="button"
      disabled={busy || !active}
      onClick={toggle}
      className={
        isFollowing
          ? "rounded-lg border border-violet-200 bg-violet-100 px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
          : "rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
      }
    >
      {busy ? "Confirming…" : isFollowing ? "Unfollow" : "Follow"}
    </button>
  );
}

export function Leaderboard() {
  const { data: traderCount, isLoading } = useReadContract({
    address: CONTRACTS_CONFIGURED ? (TRADER_REGISTRY_ADDRESS as `0x${string}`) : undefined,
    abi: traderRegistryAbi,
    functionName: "traderCount",
    query: { enabled: CONTRACTS_CONFIGURED },
  });

  const count = traderCount ?? 0n;
  const ids = useMemo(() => Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1)), [count]);

  const [rows, setRows] = useState<Record<string, TraderRow>>({});
  const onResult = useCallback(
    (row: TraderRow) => setRows((r) => ({ ...r, [row.traderId.toString()]: row })),
    [],
  );

  const [sortKey, setSortKey] = useState<SortKey>("pnl");

  const sorted = useMemo(() => {
    const list = ids.map((id) => rows[id.toString()]).filter((r): r is TraderRow => Boolean(r));
    if (sortKey === "winRate") {
      return list.sort((a, b) => b.winRate - a.winRate || Number(b.totalTrades - a.totalTrades));
    }
    if (sortKey === "pnl") {
      return list.sort((a, b) => (b.realizedPnL > a.realizedPnL ? 1 : b.realizedPnL < a.realizedPnL ? -1 : 0));
    }
    return list.sort((a, b) => (b.followerCount > a.followerCount ? 1 : b.followerCount < a.followerCount ? -1 : 0));
  }, [ids, rows, sortKey]);

  if (!CONTRACTS_CONFIGURED) {
    return <p className="text-sm text-stone-500">TraderRegistry not deployed — see banner above.</p>;
  }

  if (isLoading) {
    return <p className="text-sm text-stone-500">Reading trader registry from chain…</p>;
  }

  if (count === 0n) {
    return <p className="text-sm text-stone-500">No traders registered yet. Be the first below.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-stone-500">
        <span>Sort by:</span>
        <button
          type="button"
          onClick={() => setSortKey("pnl")}
          className={`rounded-full px-2.5 py-1 ${sortKey === "pnl" ? "bg-violet-600 font-semibold text-white" : "border border-stone-200 bg-white text-stone-600 hover:border-violet-300 hover:text-violet-700"}`}
        >
          P&amp;L
        </button>
        <button
          type="button"
          onClick={() => setSortKey("followers")}
          className={`rounded-full px-2.5 py-1 ${sortKey === "followers" ? "bg-violet-600 font-semibold text-white" : "border border-stone-200 bg-white text-stone-600 hover:border-violet-300 hover:text-violet-700"}`}
        >
          Followers
        </button>
        <button
          type="button"
          onClick={() => setSortKey("winRate")}
          className={`rounded-full px-2.5 py-1 ${sortKey === "winRate" ? "bg-violet-600 font-semibold text-white" : "border border-stone-200 bg-white text-stone-600 hover:border-violet-300 hover:text-violet-700"}`}
        >
          Win rate
        </button>
      </div>

      {ids.map((id) => (
        <TraderProbe key={id.toString()} traderId={id} onResult={onResult} />
      ))}

      {/* Mobile: one card per trader */}
      <div className="space-y-3 md:hidden">
        {sorted.map((t, i) => {
          const badge = badgeFor(t.winRate, t.totalTrades);
          return (
            <div key={t.traderId.toString()} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs text-stone-400">#{i + 1}</span>
                  <p className="font-semibold text-stone-900">
                    {t.label} {badge && <span title={badge.label}>{badge.icon}</span>}
                  </p>
                </div>
                {t.active ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    active
                  </span>
                ) : (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">inactive</span>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-stone-600">
                <div>
                  <span className="block text-stone-400">Followers</span>
                  {t.followerCount.toString()}
                </div>
                <div>
                  <span className="block text-stone-400">Win rate</span>
                  {t.winRate}%
                </div>
                <div>
                  <span className="block text-stone-400">Trades</span>
                  {t.totalTrades.toString()}
                </div>
                <div>
                  <span className="block text-stone-400">P&amp;L</span>
                  <span className={t.realizedPnL < 0n ? "text-red-600" : "text-green-600"}>
                    {formatPnL(t.realizedPnL)}
                  </span>
                </div>
                <div>
                  <span className="block text-stone-400">Volume</span>
                  {(t.totalVolume / 10n ** 18n).toString()}
                </div>
                <div>
                  <span className="block text-stone-400">Best trade</span>
                  {(t.bestTrade / 10n ** 18n).toString()}
                </div>
              </div>
              <div className="mt-3">
                <FollowButton traderId={t.traderId} active={t.active} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: full table */}
      <div className="hidden overflow-x-auto rounded-xl border border-stone-200 shadow-sm md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Label</th>
              <th className="px-4 py-3 font-medium">Wallet</th>
              <th className="px-4 py-3 font-medium">Followers</th>
              <th className="px-4 py-3 font-medium">Win rate</th>
              <th className="px-4 py-3 font-medium">Trades</th>
              <th className="px-4 py-3 font-medium">P&amp;L</th>
              <th className="px-4 py-3 font-medium">Volume</th>
              <th className="px-4 py-3 font-medium">Best trade</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const badge = badgeFor(t.winRate, t.totalTrades);
              return (
                <tr key={t.traderId.toString()} className="border-b border-stone-100 bg-white hover:bg-stone-50">
                  <td className="px-4 py-3 text-stone-400">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-stone-900">
                    {t.label} {badge && <span title={badge.label}>{badge.icon}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-stone-500">
                    <a
                      href={`https://shannon-explorer.somnia.network/address/${t.wallet}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-violet-700 hover:underline"
                    >
                      {short(t.wallet)}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-stone-600">{t.followerCount.toString()}</td>
                  <td className="px-4 py-3 text-stone-600">{t.winRate}%</td>
                  <td className="px-4 py-3 text-stone-600">{t.totalTrades.toString()}</td>
                  <td className={`px-4 py-3 ${t.realizedPnL < 0n ? "text-red-600" : "text-green-600"}`}>
                    {formatPnL(t.realizedPnL)}
                  </td>
                  <td className="px-4 py-3 text-stone-600">{(t.totalVolume / 10n ** 18n).toString()}</td>
                  <td className="px-4 py-3 text-stone-600">{(t.bestTrade / 10n ** 18n).toString()}</td>
                  <td className="px-4 py-3">
                    {t.active ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        active
                      </span>
                    ) : (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <FollowButton traderId={t.traderId} active={t.active} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
