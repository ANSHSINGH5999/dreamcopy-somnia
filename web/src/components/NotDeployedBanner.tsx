import { CONTRACTS_CONFIGURED } from "@/lib/contracts";

export function NotDeployedBanner() {
  if (CONTRACTS_CONFIGURED) return null;

  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-100 px-4 py-3 text-sm text-amber-600">
      <strong className="font-semibold">Contracts not deployed yet.</strong> Set{" "}
      <code className="rounded bg-amber-100 px-1 py-0.5">NEXT_PUBLIC_TRADER_REGISTRY_ADDRESS</code> and{" "}
      <code className="rounded bg-amber-100 px-1 py-0.5">NEXT_PUBLIC_COPY_VAULT_ADDRESS</code> in{" "}
      <code className="rounded bg-amber-100 px-1 py-0.5">web/.env.local</code> after running{" "}
      <code className="rounded bg-amber-100 px-1 py-0.5">forge script script/Deploy.s.sol --broadcast</code> in{" "}
      <code className="rounded bg-amber-100 px-1 py-0.5">dreamcopy/contracts</code>. This page shows real, live
      DreamDEX market data below regardless.
    </div>
  );
}
