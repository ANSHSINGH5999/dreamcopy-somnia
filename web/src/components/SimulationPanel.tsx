"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { DepositModal } from "@/components/DepositModal";
import { CONTRACTS_CONFIGURED, TRADER_REGISTRY_ADDRESS, traderRegistryAbi } from "@/lib/contracts";
import { SUPABASE_CONFIGURED, supabase, type SimulationRow } from "@/lib/supabase";

const POLL_INTERVAL_MS = 5_000;

interface TraderOption {
  traderId: bigint;
  label: string;
}

function TraderOptionProbe({ traderId, onResult }: { traderId: bigint; onResult: (t: TraderOption) => void }) {
  const { data: trader } = useReadContract({
    address: TRADER_REGISTRY_ADDRESS as `0x${string}`,
    abi: traderRegistryAbi,
    functionName: "getTrader",
    args: [traderId],
  });
  useEffect(() => {
    if (trader) onResult({ traderId, label: trader.label });
  }, [trader, traderId, onResult]);
  return null;
}

export function SimulationPanel() {
  const { address, isConnected } = useAccount();

  const { data: traderCount } = useReadContract({
    address: CONTRACTS_CONFIGURED ? (TRADER_REGISTRY_ADDRESS as `0x${string}`) : undefined,
    abi: traderRegistryAbi,
    functionName: "traderCount",
    query: { enabled: CONTRACTS_CONFIGURED },
  });
  const ids = useMemo(
    () => Array.from({ length: Number(traderCount ?? 0n) }, (_, i) => BigInt(i + 1)),
    [traderCount],
  );
  const [traders, setTraders] = useState<Record<string, string>>({});
  const onTraderResult = useCallback(
    (t: TraderOption) => setTraders((m) => ({ ...m, [t.traderId.toString()]: t.label })),
    [],
  );

  const [selectedTraderId, setSelectedTraderId] = useState("");
  const [virtualDeposit, setVirtualDeposit] = useState("1000");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [sim, setSim] = useState<SimulationRow | null>(null);
  const [depositModalOpen, setDepositModalOpen] = useState(false);

  // Poll the running simulation's row for indexer-driven updates.
  useEffect(() => {
    if (!sim || !supabase) return;
    const client = supabase;
    const t = setInterval(() => {
      client
        .from("simulations")
        .select("*")
        .eq("id", sim.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setSim(data as SimulationRow);
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [sim?.id, sim]);

  const start = async () => {
    if (!address || !supabase || !selectedTraderId) return;
    const deposit = Number(virtualDeposit);
    if (!Number.isFinite(deposit) || deposit <= 0) {
      setStartError("Enter a positive virtual deposit amount.");
      return;
    }
    setStarting(true);
    setStartError(null);
    const { data, error } = await supabase
      .from("simulations")
      .insert({
        wallet: address.toLowerCase(),
        trader_id: Number(selectedTraderId),
        virtual_deposit: deposit,
      })
      .select()
      .single();
    setStarting(false);
    if (error || !data) {
      setStartError(error?.message ?? "Failed to start simulation");
      return;
    }
    setSim(data as SimulationRow);
  };

  if (!SUPABASE_CONFIGURED) {
    return <p className="text-sm text-stone-500">Supabase not configured — simulations aren&apos;t available.</p>;
  }
  if (!isConnected || !address) {
    return <p className="text-sm text-stone-500">Connect your wallet to start a simulation.</p>;
  }

  if (sim) {
    const portfolioValue = sim.virtual_deposit + sim.virtual_pnl;
    const pnlPct = sim.virtual_deposit === 0 ? 0 : (sim.virtual_pnl / sim.virtual_deposit) * 100;
    const traderLabel = traders[sim.trader_id.toString()] ?? `Trader #${sim.trader_id}`;

    return (
      <div className="max-w-lg space-y-4 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        {ids.map((id) => (
          <TraderOptionProbe key={id.toString()} traderId={id} onResult={onTraderResult} />
        ))}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">Simulating {traderLabel}</h3>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
            Simulation — no real funds
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="block text-xs text-stone-500">Virtual portfolio value</span>
            <span className="text-lg font-semibold text-stone-900">{portfolioValue.toFixed(2)} USDso</span>
          </div>
          <div>
            <span className="block text-xs text-stone-500">Trades copied</span>
            <span className="text-lg font-semibold text-stone-900">{sim.trade_count}</span>
          </div>
          <div>
            <span className="block text-xs text-stone-500">P&amp;L</span>
            <span className={sim.virtual_pnl < 0 ? "text-red-600" : "text-green-600"}>
              {sim.virtual_pnl >= 0 ? "+" : ""}
              {sim.virtual_pnl.toFixed(2)} USDso
            </span>
          </div>
          <div>
            <span className="block text-xs text-stone-500">P&amp;L %</span>
            <span className={pnlPct < 0 ? "text-red-600" : "text-green-600"}>
              {pnlPct >= 0 ? "+" : ""}
              {pnlPct.toFixed(2)}%
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDepositModalOpen(true)}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
        >
          Convert to Real
        </button>

        <DepositModal
          traderId={BigInt(sim.trader_id)}
          traderLabel={traderLabel}
          isOpen={depositModalOpen}
          onClose={() => setDepositModalOpen(false)}
          initialAmount={String(sim.virtual_deposit)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      {ids.map((id) => (
        <TraderOptionProbe key={id.toString()} traderId={id} onResult={onTraderResult} />
      ))}

      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">Trader</label>
        <select
          value={selectedTraderId}
          onChange={(e) => setSelectedTraderId(e.target.value)}
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
        >
          <option value="">Select a trader…</option>
          {ids.map((id) => (
            <option key={id.toString()} value={id.toString()}>
              {traders[id.toString()] ?? `Trader #${id.toString()}`}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-stone-700">Virtual deposit (USDso, not real)</label>
        <input
          value={virtualDeposit}
          onChange={(e) => setVirtualDeposit(e.target.value)}
          className="w-40 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
        />
      </div>

      <button
        type="button"
        onClick={start}
        disabled={starting || !selectedTraderId}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
      >
        {starting ? "Starting…" : "Start Simulation"}
      </button>
      {startError && <p className="text-xs text-red-600">✕ {startError}</p>}
    </div>
  );
}
