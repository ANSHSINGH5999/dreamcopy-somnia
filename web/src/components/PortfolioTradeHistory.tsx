"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import {
  CONTRACTS_CONFIGURED,
  COPY_VAULT_ADDRESS,
  TRADER_REGISTRY_ADDRESS,
  copyVaultAbi,
  traderRegistryAbi,
} from "@/lib/contracts";
import { SUPABASE_CONFIGURED, supabase, type CopyTradeRow } from "@/lib/supabase";

const EXPLORER_TX_BASE = "https://shannon-explorer.somnia.network/tx";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/// Reports whether the connected wallet holds shares in traderId's pool —
/// used to build the set of trader_ids relevant to "my" trade history.
/// copy_trades has no usable per-follower column to filter on directly (see
/// docs/supabase_schema.sql — CopyVault.executeCopy trades a whole pool at
/// once, not per follower), so membership is determined on-chain instead.
function TraderMembershipProbe({
  traderId,
  address,
  onResult,
}: {
  traderId: bigint;
  address: `0x${string}`;
  onResult: (traderId: bigint, hasStake: boolean) => void;
}) {
  const { data: shares } = useReadContract({
    address: COPY_VAULT_ADDRESS as `0x${string}`,
    abi: copyVaultAbi,
    functionName: "sharesOf",
    args: [traderId, address],
  });

  useEffect(() => {
    if (shares !== undefined) {
      onResult(traderId, shares > 0n);
    }
  }, [shares, traderId, onResult]);

  return null;
}

export function PortfolioTradeHistory() {
  const { address, isConnected } = useAccount();

  const { data: traderCount } = useReadContract({
    address: CONTRACTS_CONFIGURED ? (TRADER_REGISTRY_ADDRESS as `0x${string}`) : undefined,
    abi: traderRegistryAbi,
    functionName: "traderCount",
    query: { enabled: CONTRACTS_CONFIGURED },
  });

  const allIds = useMemo(
    () => Array.from({ length: Number(traderCount ?? 0n) }, (_, i) => BigInt(i + 1)),
    [traderCount],
  );

  const [membership, setMembership] = useState<Record<string, boolean>>({});
  const onProbeResult = useCallback(
    (traderId: bigint, hasStake: boolean) =>
      setMembership((m) => (m[traderId.toString()] === hasStake ? m : { ...m, [traderId.toString()]: hasStake })),
    [],
  );

  const membershipReady = allIds.length === Object.keys(membership).length;
  const myTraderIds = useMemo(() => allIds.filter((id) => membership[id.toString()]), [allIds, membership]);

  const [rows, setRows] = useState<CopyTradeRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [traderFilter, setTraderFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase || !address || !membershipReady) return;

    if (myTraderIds.length === 0) {
      setRows([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    let query = supabase
      .from("copy_trades")
      .select("*")
      .in(
        "trader_id",
        myTraderIds.map((id) => Number(id)),
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (traderFilter !== "all") query = query.eq("trader_id", Number(traderFilter));
    if (marketFilter !== "all") query = query.eq("market", marketFilter);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (fromDate) query = query.gte("created_at", new Date(fromDate).toISOString());
    if (toDate) query = query.lte("created_at", new Date(`${toDate}T23:59:59`).toISOString());

    query.then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setRows([]);
      } else {
        setRows(data as CopyTradeRow[]);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [address, membershipReady, myTraderIds, traderFilter, marketFilter, statusFilter, fromDate, toDate]);

  const marketOptions = useMemo(() => {
    const set = new Set<string>();
    (rows ?? []).forEach((r) => set.add(r.market));
    return Array.from(set);
  }, [rows]);

  if (!CONTRACTS_CONFIGURED) return null;
  if (!isConnected || !address) return null;

  if (!SUPABASE_CONFIGURED) {
    return (
      <p className="text-sm text-stone-500">
        Trade history isn&apos;t configured (Supabase env vars unset) — on-chain positions above are still live and
        correct.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {allIds.map((id) => (
        <TraderMembershipProbe key={id.toString()} traderId={id} address={address} onResult={onProbeResult} />
      ))}

      <h2 className="text-lg font-semibold text-stone-900">Trade history</h2>

      <div className="flex flex-wrap gap-3">
        <select
          value={traderFilter}
          onChange={(e) => setTraderFilter(e.target.value)}
          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
        >
          <option value="all">All traders</option>
          {myTraderIds.map((id) => (
            <option key={id.toString()} value={id.toString()}>
              Trader #{id.toString()}
            </option>
          ))}
        </select>

        <select
          value={marketFilter}
          onChange={(e) => setMarketFilter(e.target.value)}
          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
        >
          <option value="all">All markets</option>
          {marketOptions.map((m) => (
            <option key={m} value={m}>
              {short(m)}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
        >
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>

        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
        />
      </div>

      {loadError && <p className="text-xs text-red-600">✕ Failed to load trade history: {loadError}</p>}
      {loading && <p className="text-xs text-stone-500">Loading trade history…</p>}

      {!loading && rows && rows.length === 0 && (
        <p className="text-sm text-stone-500">No copy trades yet for the pools you hold a stake in.</p>
      )}

      {!loading && rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-stone-200 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Trader</th>
                <th className="px-4 py-3 font-medium">Market</th>
                <th className="px-4 py-3 font-medium">Side</th>
                <th className="px-4 py-3 font-medium">Qty</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-stone-100 bg-white hover:bg-stone-50">
                  <td className="px-4 py-3 text-stone-500">{new Date(row.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-stone-600">#{row.trader_id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-stone-500">{short(row.market)}</td>
                  <td className="px-4 py-3">
                    {row.is_bid ? (
                      <span className="rounded-full bg-violet-600 px-2 py-0.5 text-xs font-semibold text-white">
                        BUY
                      </span>
                    ) : (
                      <span className="rounded-full border border-violet-300 bg-white px-2 py-0.5 text-xs text-violet-700">
                        SELL
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-stone-600">{row.quantity}</td>
                  <td className="px-4 py-3 font-mono text-xs text-stone-600">{row.price}</td>
                  <td className="px-4 py-3">
                    {row.status === "success" && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        success
                      </span>
                    )}
                    {row.status === "failed" && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        ⚠ failed
                      </span>
                    )}
                    {row.status === "skipped" && (
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">skipped</span>
                    )}
                    {row.status === "skipped" && row.skip_reason && (
                      <div className="mt-1 max-w-[220px] text-xs text-stone-400">{row.skip_reason}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.tx_hash ? (
                      <a
                        href={`${EXPLORER_TX_BASE}/${row.tx_hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-violet-700 hover:underline"
                      >
                        {short(row.tx_hash)} ↗
                      </a>
                    ) : (
                      <span className="text-xs text-stone-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
