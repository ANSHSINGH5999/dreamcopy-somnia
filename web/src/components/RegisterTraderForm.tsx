"use client";

import { useState, type FormEvent } from "react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { CONTRACTS_CONFIGURED, TRADER_REGISTRY_ADDRESS, traderRegistryAbi } from "@/lib/contracts";

export function RegisterTraderForm() {
  const { address, isConnected } = useAccount();
  const [label, setLabel] = useState("");
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: Boolean(txHash) },
  });

  if (!CONTRACTS_CONFIGURED) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    writeContract({
      address: TRADER_REGISTRY_ADDRESS as `0x${string}`,
      abi: traderRegistryAbi,
      functionName: "registerTrader",
      args: [label.trim()],
      // Explicit gas — see StrategyCard.tsx's comment on why leaving this
      // unset triggers "rpc execution gas limit exceeded" on Somnia.
      gas: 3_000_000n,
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
    >
      <label className="flex-1 min-w-[200px]">
        <span className="mb-1 block text-sm font-medium text-stone-700">
          Register your wallet as a followable trader
        </span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. alpha-desk"
          disabled={!isConnected}
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
        />
      </label>
      <button
        type="submit"
        disabled={!isConnected || !label.trim() || isPending || isConfirming}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
      >
        {isPending || isConfirming ? "Registering…" : "Register"}
      </button>
      {!isConnected && <span className="text-xs text-stone-400">Connect your wallet first</span>}
      {isSuccess && <span className="text-xs text-green-600">✓ Registered as trader #{address ? "✓" : ""}</span>}
      {error && <span className="text-xs text-red-600">✕ {error.message.slice(0, 120)}</span>}
    </form>
  );
}
