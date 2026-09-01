import { MarketDistributionChart } from "@/components/charts/MarketDistributionChart";
import { SuccessRateRing } from "@/components/charts/SuccessRateRing";
import { TopTradersChart } from "@/components/charts/TopTradersChart";
import { VolumeOverTimeChart } from "@/components/charts/VolumeOverTimeChart";

export default function AnalyticsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold text-stone-900">Analytics</h1>
        <p className="mt-2 text-sm text-stone-500">
          All charts read from Supabase&apos;s <code className="rounded bg-stone-100 px-1">copy_trades</code>{" "}
          activity log (successful copy trades only) — an activity log, not a source of truth. On-chain numbers on{" "}
          <a href="/portfolio" className="text-violet-700 hover:underline">
            Portfolio
          </a>{" "}
          always win if the two ever disagree.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <VolumeOverTimeChart />
        <MarketDistributionChart />
        <SuccessRateRing />
        <TopTradersChart />
      </div>
    </div>
  );
}
