import Link from "next/link";
import { fetchMarketsWithFallback } from "@/lib/dreamdex";
import { ActivityFeed } from "@/components/ActivityFeed";
import { NotDeployedBanner } from "@/components/NotDeployedBanner";
import { ProtocolStats } from "@/components/ProtocolStats";

export default async function HomePage() {
  const { markets, _source } = await fetchMarketsWithFallback();

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-5xl font-semibold leading-tight text-stone-900 sm:text-6xl">DreamCopy</h1>
        <p className="mt-3 max-w-2xl text-stone-600">
          Non-custodial copy trading for DreamDEX on Somnia testnet. Deposit collateral into an on-chain vault,
          follow a trader, and their executed fills get proportionally mirrored for every follower — funds never
          leave the vault contract except back to you.
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            href="/traders"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            Browse traders
          </Link>
          <Link
            href="/portfolio"
            className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            View portfolio
          </Link>
        </div>
      </section>

      <NotDeployedBanner />

      <ProtocolStats />

      <section>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-600 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-600" />
          </span>
          <h2 className="text-2xl font-semibold text-stone-900">Live Activity</h2>
        </div>
        <ActivityFeed />
        <p className="mt-2 text-xs text-stone-400">Powered by Supabase Realtime</p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-stone-900">Live DreamDEX markets</h2>
        <p className="mt-1 text-sm text-stone-500">
          Fetched via <code className="rounded bg-stone-100 px-1">/api/markets</code>, which proxies DreamDEX&apos;s{" "}
          <code className="rounded bg-stone-100 px-1">GET /v0/markets</code> (cached 60s) — this is exactly the data
          CopyVault&apos;s pool allow-list is populated from, never hard-coded from here.
        </p>

        {_source === "fallback" && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-100 px-4 py-3 text-sm text-amber-600">
            Showing cached market data — live API temporarily unavailable.
          </p>
        )}

        {markets.length === 0 && <p className="mt-4 text-sm text-stone-500">No markets returned.</p>}

        {markets.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200 shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Pool contract</th>
                  <th className="px-4 py-3 font-medium">Tick size</th>
                  <th className="px-4 py-3 font-medium">Lot size</th>
                  <th className="px-4 py-3 font-medium">Min qty</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m) => (
                  <tr key={m.contract} className="border-b border-stone-100 bg-white hover:bg-stone-50">
                    <td className="px-4 py-3 font-medium text-stone-900">{m.symbol}</td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-500">
                      <a
                        href={`https://shannon-explorer.somnia.network/address/${m.contract}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-violet-700 hover:underline"
                      >
                        {m.contract}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-stone-600">{m.tickSize}</td>
                    <td className="px-4 py-3 text-stone-600">{m.lotSize}</td>
                    <td className="px-4 py-3 text-stone-600">{m.minQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
