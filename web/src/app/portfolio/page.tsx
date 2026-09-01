import { NotDeployedBanner } from "@/components/NotDeployedBanner";
import { PortfolioAllocations } from "@/components/PortfolioAllocations";
import { PortfolioList } from "@/components/PortfolioList";
import { PortfolioTradeHistory } from "@/components/PortfolioTradeHistory";

export default function PortfolioPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold text-stone-900">Portfolio</h1>
        <p className="mt-1 text-sm text-stone-500">
          Every position number here is read live from CopyVault on-chain — no database mirroring. Withdrawals only
          ever pay out of a pool&apos;s idle collateral; funds currently deployed in an open copied position
          aren&apos;t withdrawable until that position closes (see{" "}
          <code className="rounded bg-stone-100 px-1">docs/LIMITATIONS.md</code>). Trade history below is an activity
          log from Supabase, not a source of truth — it never overrides the on-chain numbers above.
        </p>
      </div>
      <NotDeployedBanner />
      <PortfolioAllocations />
      <PortfolioList />
      <PortfolioTradeHistory />
    </div>
  );
}
