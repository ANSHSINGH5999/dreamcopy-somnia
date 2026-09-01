import { SimulationPanel } from "@/components/SimulationPanel";

export default function SimulatePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold text-stone-900">Simulate</h1>
        <p className="mt-2 max-w-xl text-sm text-stone-500">
          Paper-trade a copy of any trader with virtual funds before risking real capital. Your simulation mirrors
          every real fill from that trader, scaled to your virtual deposit — no wallet approval, no real money.
        </p>
      </div>

      <SimulationPanel />
    </div>
  );
}
