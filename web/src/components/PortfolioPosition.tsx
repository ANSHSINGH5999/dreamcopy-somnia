"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import {
  COPY_VAULT_ADDRESS,
  COLLATERAL_TOKEN_ADDRESS,
  copyVaultAbi,
  erc20Abi,
  traderRegistryAbi,
  TRADER_REGISTRY_ADDRESS,
} from "@/lib/contracts";

export function PortfolioPosition({ traderId }: { traderId: bigint }) {
  const { address } = useAccount();
  const vault = COPY_VAULT_ADDRESS as `0x${string}`;
  const registry = TRADER_REGISTRY_ADDRESS as `0x${string}`;
  const token = COLLATERAL_TOKEN_ADDRESS as `0x${string}`;
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const { data: shares, refetch: refetchShares } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "sharesOf",
    args: address ? [traderId, address] : undefined,
    query: { enabled: Boolean(address) },
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

  const { data: idleBalance } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "tokenBalance",
    args: [traderId, token],
    query: { enabled: Boolean(token) },
  });

  const { data: trader } = useReadContract({
    address: registry,
    abi: traderRegistryAbi,
    functionName: "getTrader",
    args: [traderId],
  });

  const { data: isPaused, refetch: refetchPaused } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "copyingPaused",
    args: address ? [address, traderId] : undefined,
    query: { enabled: Boolean(address) },
  });
  const [optimisticPaused, setOptimisticPaused] = useState<boolean | null>(null);
  useEffect(() => {
    if (isPaused !== undefined) setOptimisticPaused(null); // real value arrived, drop the optimistic guess
  }, [isPaused]);
  const displayPaused = optimisticPaused ?? isPaused ?? false;

  const { writeContract: writePause, isPending: pausePending } = useWriteContract();
  const togglePause = () => {
    setOptimisticPaused(!displayPaused);
    writePause(
      {
        address: vault,
        abi: copyVaultAbi,
        functionName: displayPaused ? "resumeCopying" : "pauseCopying",
        args: [traderId],
        // Explicit gas — see StrategyCard.tsx's comment on why leaving this
        // unset triggers "rpc execution gas limit exceeded" on Somnia.
        gas: 3_000_000n,
      },
      {
        onSuccess: () => void refetchPaused(),
        onError: () => setOptimisticPaused(null), // revert the optimistic flip on failure
      },
    );
  };

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

  if (!shares || shares === 0n) return null;

  const estimatedValue = totalShares && totalShares > 0n && nav !== undefined ? (shares * nav) / totalShares : 0n;

  const onWithdraw = () => {
    if (!withdrawAmount.trim() || decimals === undefined) return;
    let shareAmount: bigint;
    try {
      // Shares track collateral 1:1 at mint time (see CopyVault.sol docs) so
      // they share the collateral token's decimals.
      shareAmount = BigInt(Math.floor(Number(withdrawAmount) * 10 ** decimals));
    } catch {
      return;
    }
    writeContract(
      {
        address: vault,
        abi: copyVaultAbi,
        functionName: "withdraw",
        args: [traderId, shareAmount],
        gas: 3_000_000n,
      },
      { onSuccess: () => void refetchShares() },
    );
  };

  const busy = isPending || isConfirming;

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-stone-900">
            {trader?.label ?? `Trader #${traderId.toString()}`}{" "}
            <span className="text-xs text-stone-400">#{traderId.toString()}</span>{" "}
            {displayPaused ? (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">Paused</span>
            ) : (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Copying
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-stone-500">
            {decimals !== undefined ? formatUnits(shares, decimals) : shares.toString()} shares · est. value{" "}
            {decimals !== undefined ? formatUnits(estimatedValue, decimals) : estimatedValue.toString()}{" "}
            {symbol ?? ""}
          </p>
          <p className="mt-1 text-xs text-stone-400">
            Idle (withdrawable) in pool:{" "}
            {decimals !== undefined && idleBalance !== undefined ? formatUnits(idleBalance, decimals) : "…"}{" "}
            {symbol ?? ""}
          </p>
        </div>
      </div>
      <p className="mt-2 text-xs text-stone-400">
        Pausing is a personal, advisory preference — it doesn&apos;t stop the pool&apos;s trades (which are shared
        across every follower); it only marks your own intent. Withdraw idle collateral below if you want to
        actually stop being exposed.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={togglePause}
          disabled={pausePending}
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
        >
          {displayPaused ? "Resume copying" : "Pause copying"}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          value={withdrawAmount}
          onChange={(e) => setWithdrawAmount(e.target.value)}
          placeholder={`Amount of shares (${symbol ?? "collateral"} units)`}
          className="w-56 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
        />
        <button
          type="button"
          onClick={onWithdraw}
          disabled={busy || !withdrawAmount.trim()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
        >
          {busy ? "Withdrawing…" : "Withdraw"}
        </button>
        {isSuccess && <span className="text-xs text-green-600">✓ Withdrawn</span>}
        {error && <span className="text-xs text-red-600">✕ {error.message.slice(0, 140)}</span>}
      </div>
    </div>
  );
}
