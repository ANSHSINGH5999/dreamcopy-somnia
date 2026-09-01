"use client";

import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import {
  COLLATERAL_TOKEN_ADDRESS,
  COPY_VAULT_ADDRESS,
  copyVaultAbi,
  erc20Abi,
  traderRegistryAbi,
  TRADER_REGISTRY_ADDRESS,
} from "@/lib/contracts";

/// Displays and — for the CopyVault owner only — edits the pool-wide risk
/// guardrails for one trader's pool. `setRiskParams` is `onlyOwner`: these
/// are protocol-level circuit breakers per traderId, not a personal
/// per-follower setting (executeCopy trades a trader's entire pooled
/// balance in one call — see CopyVault.sol's RiskParams doc comment for why
/// a truly personal version isn't safely enforceable on-chain). Everyone
/// can see the current values before depositing; only the owner can change
/// them.
export function RiskParamsPanel({ traderId, traderLabel }: { traderId: bigint; traderLabel: string }) {
  const { address } = useAccount();
  const vault = COPY_VAULT_ADDRESS as `0x${string}`;
  const token = COLLATERAL_TOKEN_ADDRESS as `0x${string}`;

  const { data: owner } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "owner",
  });
  const isOwner = Boolean(address && owner && address.toLowerCase() === (owner as string).toLowerCase());

  const { data: riskParamsData, refetch: refetchRiskParams } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "riskParams",
    args: [traderId],
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

  const currentMaxLoss = riskParamsData?.[0] ?? 0n;
  const currentMaxAllocPct = riskParamsData?.[1] ?? 0n;
  const currentPaused = riskParamsData?.[2] ?? false;

  const { data: stopLossPct, refetch: refetchStopLoss } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "stopLossPct",
    args: [traderId],
  });
  const { data: cumulativeLoss } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "cumulativeLoss",
    args: [traderId],
  });
  const { data: poolNav } = useReadContract({
    address: vault,
    abi: copyVaultAbi,
    functionName: "poolNav",
    args: [traderId],
  });

  const [draftMaxLoss, setDraftMaxLoss] = useState("0");
  const [draftMaxAllocPct, setDraftMaxAllocPct] = useState(0);
  const [draftPaused, setDraftPaused] = useState(false);
  const [draftStopLossPct, setDraftStopLossPct] = useState(0);

  useEffect(() => {
    if (riskParamsData && decimals !== undefined) {
      setDraftMaxLoss(formatUnits(riskParamsData[0], decimals));
      setDraftMaxAllocPct(Number(riskParamsData[1]));
      setDraftPaused(riskParamsData[2]);
    }
  }, [riskParamsData, decimals]);

  useEffect(() => {
    if (stopLossPct !== undefined) setDraftStopLossPct(Number(stopLossPct));
  }, [stopLossPct]);

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: Boolean(txHash) },
  });

  useEffect(() => {
    if (isSuccess) void refetchRiskParams();
  }, [isSuccess, refetchRiskParams]);

  const save = () => {
    if (decimals === undefined) return;
    let maxLossRaw: bigint;
    try {
      maxLossRaw = parseUnits(draftMaxLoss.trim() || "0", decimals);
    } catch {
      return;
    }
    writeContract({
      address: vault,
      abi: copyVaultAbi,
      functionName: "setRiskParams",
      args: [traderId, maxLossRaw, BigInt(draftMaxAllocPct), draftPaused],
      // Explicit gas — see StrategyCard.tsx's comment on why leaving this
      // unset triggers "rpc execution gas limit exceeded" on Somnia.
      gas: 3_000_000n,
    });
  };

  const busy = isPending || isConfirming;

  const {
    writeContract: writeStopLoss,
    data: stopLossTxHash,
    isPending: stopLossPending,
    error: stopLossError,
  } = useWriteContract();
  const { isLoading: stopLossConfirming, isSuccess: stopLossSuccess } = useWaitForTransactionReceipt({
    hash: stopLossTxHash,
    query: { enabled: Boolean(stopLossTxHash) },
  });
  useEffect(() => {
    if (stopLossSuccess) void refetchStopLoss();
  }, [stopLossSuccess, refetchStopLoss]);

  const saveStopLoss = () => {
    writeStopLoss({
      address: vault,
      abi: copyVaultAbi,
      functionName: "setStopLoss",
      args: [traderId, BigInt(draftStopLossPct)],
      gas: 3_000_000n,
    });
  };
  const stopLossBusy = stopLossPending || stopLossConfirming;

  const stopLossThreshold =
    poolNav !== undefined && stopLossPct !== undefined ? (poolNav * stopLossPct) / 100n : undefined;
  const nearThreshold =
    stopLossThreshold !== undefined &&
    stopLossThreshold > 0n &&
    cumulativeLoss !== undefined &&
    cumulativeLoss * 10n >= stopLossThreshold * 9n; // within 10% of threshold

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-900">Risk guardrails — {traderLabel}</h3>
        {currentPaused && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-600">
            copying paused
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-stone-500">
        Pool-wide, set by the CopyVault owner — protects everyone depositing into this trader&apos;s pool, not a
        personal per-follower setting (see contracts/src/CopyVault.sol for why).
      </p>

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div>
          <span className="mb-1 block text-sm font-medium text-stone-700">
            Max allocation per trade: {isOwner ? draftMaxAllocPct : Number(currentMaxAllocPct)}%{" "}
            {(isOwner ? draftMaxAllocPct : Number(currentMaxAllocPct)) === 0 && "(disabled)"}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={isOwner ? draftMaxAllocPct : Number(currentMaxAllocPct)}
            onChange={(e) => setDraftMaxAllocPct(Number(e.target.value))}
            disabled={!isOwner}
            className="w-full accent-violet-600 disabled:opacity-50"
          />
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-stone-700">
            Max loss per trade ({symbol ?? "collateral"}) — 0 = disabled
          </span>
          <input
            value={isOwner ? draftMaxLoss : formatUnits(currentMaxLoss, decimals ?? 18)}
            onChange={(e) => setDraftMaxLoss(e.target.value)}
            disabled={!isOwner}
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
          />
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isOwner ? draftPaused : currentPaused}
            onChange={(e) => setDraftPaused(e.target.checked)}
            disabled={!isOwner}
            className="h-4 w-4 accent-violet-600 disabled:opacity-50"
          />
          <span className="text-sm text-stone-700">Pause copying for this pool</span>
        </label>
      </div>

      {isOwner ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
          >
            {busy ? "Saving…" : "Save risk params"}
          </button>
          {isSuccess && <span className="text-xs text-green-600">✓ Saved</span>}
          {error && <span className="text-xs text-red-600">✕ {error.message.slice(0, 140)}</span>}
        </div>
      ) : (
        <p className="mt-3 text-xs text-stone-400">Only the CopyVault owner can change these values.</p>
      )}

      <div className="mt-4 border-t border-stone-200 pt-4">
        <h4 className="text-sm font-semibold text-stone-900">Stop-loss</h4>
        <p className="mt-1 text-xs text-stone-500">
          Pool-wide too — once realized losses exceed this % of pool NAV, copying auto-pauses for everyone (reuses
          the risk-guardrails pause above).
        </p>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-sm font-medium text-stone-700">
              Stop-loss threshold: {isOwner ? draftStopLossPct : Number(stopLossPct ?? 0n)}%{" "}
              {(isOwner ? draftStopLossPct : Number(stopLossPct ?? 0n)) === 0 && "(disabled)"}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={isOwner ? draftStopLossPct : Number(stopLossPct ?? 0n)}
              onChange={(e) => setDraftStopLossPct(Number(e.target.value))}
              disabled={!isOwner}
              className="w-full accent-violet-600 disabled:opacity-50"
            />
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-stone-700">
              Cumulative realized loss vs. threshold
            </span>
            <p className={`text-sm ${nearThreshold ? "font-semibold text-amber-600" : "text-stone-600"}`}>
              {decimals !== undefined && cumulativeLoss !== undefined ? formatUnits(cumulativeLoss, decimals) : "…"}{" "}
              /{" "}
              {decimals !== undefined && stopLossThreshold !== undefined
                ? formatUnits(stopLossThreshold, decimals)
                : "…"}{" "}
              {symbol ?? ""}
            </p>
            {nearThreshold && (
              <p className="mt-1 text-xs text-amber-600">⚠ Within 10% of the stop-loss threshold.</p>
            )}
          </div>
        </div>

        {isOwner && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveStopLoss}
              disabled={stopLossBusy}
              className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
            >
              {stopLossBusy ? "Saving…" : "Save stop-loss"}
            </button>
            {stopLossSuccess && <span className="text-xs text-green-600">✓ Saved</span>}
            {stopLossError && (
              <span className="text-xs text-red-600">✕ {stopLossError.message.slice(0, 140)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
