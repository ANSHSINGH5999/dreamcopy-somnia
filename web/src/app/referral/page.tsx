"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { readContract } from "wagmi/actions";
import { wagmiConfig } from "@/lib/wagmi";
import {
  COLLATERAL_TOKEN_ADDRESS,
  REFERRAL_REGISTRY_ADDRESS,
  erc20Abi,
  referralRegistryAbi,
} from "@/lib/contracts";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface LeaderboardEntry {
  referrer: `0x${string}`;
  count: number;
}

/// Top referrers by count, read directly on-chain (referrerCount +
/// referrers(i) + referralCount(referrers(i))) — NOT via event-log
/// scanning. This chain's RPC caps eth_getLogs at a 1000-block range and is
/// already past block 475M, confirmed directly against the live RPC, so a
/// client-side "scan all history" approach is not viable here. See
/// contracts/src/ReferralRegistry.sol's `referrers` array doc comment.
function useReferralLeaderboard() {
  const publicClient = usePublicClient();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    if (!publicClient || !REFERRAL_REGISTRY_ADDRESS) return;
    let cancelled = false;
    const registry = REFERRAL_REGISTRY_ADDRESS as `0x${string}`;

    (async () => {
      const count = await readContract(wagmiConfig, {
        address: registry,
        abi: referralRegistryAbi,
        functionName: "referrerCount",
      });

      const referrers = await Promise.all(
        Array.from({ length: Number(count) }, (_, i) =>
          readContract(wagmiConfig, {
            address: registry,
            abi: referralRegistryAbi,
            functionName: "referrers",
            args: [BigInt(i)],
          }),
        ),
      );

      const withCounts = await Promise.all(
        referrers.map(async (referrer) => ({
          referrer,
          count: Number(
            await readContract(wagmiConfig, {
              address: registry,
              abi: referralRegistryAbi,
              functionName: "referralCount",
              args: [referrer],
            }),
          ),
        })),
      );

      if (cancelled) return;
      setEntries(withCounts.sort((a, b) => b.count - a.count).slice(0, 5));
    })().catch(() => {
      if (!cancelled) setEntries([]);
    });

    return () => {
      cancelled = true;
    };
  }, [publicClient]);

  return entries;
}

export default function ReferralPage() {
  const { address, isConnected } = useAccount();
  const registry = REFERRAL_REGISTRY_ADDRESS as `0x${string}`;
  const token = COLLATERAL_TOKEN_ADDRESS as `0x${string}`;
  const configured = Boolean(REFERRAL_REGISTRY_ADDRESS);

  const { data: referralCount } = useReadContract({
    address: registry,
    abi: referralRegistryAbi,
    functionName: "referralCount",
    args: address ? [address] : undefined,
    query: { enabled: configured && Boolean(address) },
  });
  const { data: earnings, refetch: refetchEarnings } = useReadContract({
    address: registry,
    abi: referralRegistryAbi,
    functionName: "referralEarnings",
    args: address ? [address] : undefined,
    query: { enabled: configured && Boolean(address) },
  });
  const { data: decimals } = useReadContract({
    address: token || undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: Boolean(token) },
  });
  const { data: symbol } = useReadContract({
    address: token || undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: Boolean(token) },
  });

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: Boolean(txHash) },
  });
  useEffect(() => {
    if (isSuccess) void refetchEarnings();
  }, [isSuccess, refetchEarnings]);

  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const leaderboard = useReferralLeaderboard();

  const claim = () => {
    writeContract({
      address: registry,
      abi: referralRegistryAbi,
      functionName: "claimEarnings",
      // Explicit gas — see StrategyCard.tsx's comment on why leaving this
      // unset triggers "rpc execution gas limit exceeded" on Somnia.
      gas: 3_000_000n,
    });
  };

  const referralLink = address ? `${origin}/ref/${address}` : "";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold text-stone-900">Referrals</h1>
        <p className="mt-1 text-sm text-stone-500">
          Share your link. When someone you referred makes their first deposit, you earn{" "}
          {`${(50 / 100).toFixed(1)}%`} of it — see{" "}
          <code className="rounded bg-stone-100 px-1">contracts/src/ReferralRegistry.sol</code>.
        </p>
      </div>

      {!configured ? (
        <p className="text-sm text-stone-500">ReferralRegistry not deployed — see banner above.</p>
      ) : !isConnected || !address ? (
        <p className="text-sm text-stone-500">Connect your wallet to see your referral link and earnings.</p>
      ) : (
        <>
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <span className="mb-1 block text-sm font-medium text-stone-700">Your referral link</span>
            <div className="flex flex-wrap items-center gap-3">
              <code className="rounded-lg bg-violet-100 px-3 py-2 text-sm text-violet-700">
                {referralLink || "…"}
              </code>
              {referralLink && (
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(referralLink)}
                  className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50"
                >
                  Copy
                </button>
              )}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <span className="block text-xs text-stone-500">Total referrals</span>
                <span className="text-xl font-semibold text-stone-900">{(referralCount ?? 0n).toString()}</span>
              </div>
              <div>
                <span className="block text-xs text-stone-500">Claimable earnings</span>
                <span className="text-xl font-semibold text-stone-900">
                  {decimals !== undefined && earnings !== undefined ? formatUnits(earnings, decimals) : "…"}{" "}
                  {symbol ?? ""}
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={claim}
                disabled={isPending || isConfirming || !earnings || earnings === 0n}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
              >
                {isPending || isConfirming ? "Claiming…" : "Claim earnings"}
              </button>
              {isSuccess && <span className="text-xs text-green-600">✓ Claimed</span>}
              {error && <span className="text-xs text-red-600">✕ {error.message.slice(0, 140)}</span>}
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-stone-900">Top referrers</h2>
            {leaderboard === null ? (
              <p className="mt-2 text-sm text-stone-500">Loading…</p>
            ) : leaderboard.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">No referrals yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">#</th>
                      <th className="px-4 py-3 font-medium">Referrer</th>
                      <th className="px-4 py-3 font-medium">Referrals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((entry, i) => (
                      <tr key={entry.referrer} className="border-b border-stone-100 bg-white hover:bg-stone-50">
                        <td className="px-4 py-3 text-stone-400">{i + 1}</td>
                        <td className="px-4 py-3 font-mono text-xs text-stone-600">{short(entry.referrer)}</td>
                        <td className="px-4 py-3 text-stone-600">{entry.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
