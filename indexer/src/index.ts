import { config } from "./config.js";
import { detector } from "./detector.js";
import { handleTrade } from "./executor.js";
import { startReferralWatcher } from "./notifications.js";

async function main(): Promise<void> {
  console.log("[index] starting DreamCopy indexer...");
  console.log(`[index] RPC:              ${config.rpcUrl}`);
  console.log(`[index] WS:               ${config.wsUrl}`);
  console.log(`[index] TraderRegistry:   ${config.traderRegistryAddress}`);
  console.log(`[index] CopyVault:        ${config.copyVaultAddress}`);
  console.log(`[index] ReferralRegistry: ${config.referralRegistryAddress}`);

  startReferralWatcher();

  detector.on("trade", (trade, traderId) => {
    handleTrade(trade, traderId).catch((err) => {
      // handleTrade already catches internally and never rejects, but guard
      // the event-emitter callback too — an uncaught rejection here would
      // otherwise crash the process.
      console.error("[index] unhandled error in handleTrade:", err);
    });
  });

  await detector.start();

  console.log(`DreamCopy indexer running, watching ${detector.watchedCount} traders`);

  const shutdown = (signal: string) => {
    console.log(`[index] received ${signal}, shutting down...`);
    detector.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[index] fatal error during startup:", err);
  process.exit(1);
});
