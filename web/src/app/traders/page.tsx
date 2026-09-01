import { Leaderboard } from "@/components/Leaderboard";
import { NotDeployedBanner } from "@/components/NotDeployedBanner";
import { RegisterTraderForm } from "@/components/RegisterTraderForm";

export default function TradersPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold text-stone-900">Traders</h1>
        <p className="mt-2 text-sm text-stone-500">
          Reads directly from TraderRegistry on-chain — no database mirroring, sorted by follower count. Following a
          trader here doesn&apos;t move funds; deposit collateral on the{" "}
          <a href="/follow" className="text-violet-700 hover:underline">
            Follow
          </a>{" "}
          page to actually start copying.
        </p>
      </div>
      <NotDeployedBanner />
      <RegisterTraderForm />
      <Leaderboard />
    </div>
  );
}
