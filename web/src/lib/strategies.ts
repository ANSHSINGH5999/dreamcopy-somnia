export interface TraderCandidate {
  traderId: bigint;
  label: string;
  active: boolean;
  followerCount: bigint;
  winRate: number;
}

export interface StrategyAllocation {
  traderId: bigint;
  label: string;
  allocationPct: number;
}

export interface StrategyTemplate {
  id: string;
  name: string;
  riskLevel: "Low" | "Medium" | "High";
  description: string;
  /// Pool-wide risk targets this strategy assumes for the traders it
  /// follows — INFORMATIONAL ONLY. setRiskParams/setStopLoss on CopyVault
  /// are onlyOwner (pool-wide circuit breakers protecting every follower
  /// of that trader, not a personal setting — see CopyVault.sol's
  /// RiskParams doc comment) — a regular user applying a strategy cannot
  /// call them, so "Apply" never tries to. These numbers are shown so the
  /// user can see whether the trader's ACTUAL on-chain risk params (read
  /// separately, live) already match what this strategy assumes.
  targetMaxAllocationPct: number;
  targetStopLossPct: number;
  /// Picks which active traders this strategy follows, and how a 100%
  /// portfolio splits across them. Pure/deterministic given the current
  /// on-chain trader list — used for both Preview and Apply.
  selectAllocations(traders: TraderCandidate[]): StrategyAllocation[];
}

function equalSplit(traders: TraderCandidate[]): StrategyAllocation[] {
  if (traders.length === 0) return [];
  const pct = Math.floor(100 / traders.length); // never exceed 100 in total — see setAllocations's own cap
  return traders.map((t) => ({ traderId: t.traderId, label: t.label, allocationPct: pct }));
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: "safe-follower",
    name: "Safe Follower",
    riskLevel: "Low",
    description: "Follow the single best performer with tight risk controls",
    targetMaxAllocationPct: 20,
    targetStopLossPct: 10,
    selectAllocations(traders) {
      const active = traders.filter((t) => t.active);
      const top = [...active].sort((a, b) => b.winRate - a.winRate)[0];
      return top ? [{ traderId: top.traderId, label: top.label, allocationPct: 100 }] : [];
    },
  },
  {
    id: "aggressive-copycat",
    name: "Aggressive Copycat",
    riskLevel: "High",
    description: "Copy top 3 traders with higher size and looser stops",
    targetMaxAllocationPct: 50,
    targetStopLossPct: 25,
    selectAllocations(traders) {
      const active = traders.filter((t) => t.active);
      const top3 = [...active].sort((a, b) => Number(b.followerCount - a.followerCount)).slice(0, 3);
      return equalSplit(top3);
    },
  },
  {
    id: "diversified",
    name: "Diversified",
    riskLevel: "Medium",
    description: "Spread risk across all active traders evenly",
    targetMaxAllocationPct: 15,
    targetStopLossPct: 15,
    selectAllocations(traders) {
      return equalSplit(traders.filter((t) => t.active));
    },
  },
];
