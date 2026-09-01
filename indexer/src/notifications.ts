import { provider, referralRegistry } from "./contracts.js";
import { getNotificationPrefs } from "./supabase.js";
import { sendTelegramMessage } from "./telegram.js";
import type { TradeEvent } from "./types.js";

/// Smart notification router — reads each recipient's own
/// dreamcopy/docs/supabase_schema.sql `notification_prefs` row before every
/// send, honors opt-outs and their min_trade_size threshold, and picks the
/// right message template per kind. telegram.ts stays the low-level
/// transport (sendTelegramMessage); this is the layer executor.ts actually
/// calls.
///
/// "Notify on copy trades" has no single natural recipient:
/// CopyVault.executeCopy trades a trader's entire pooled balance in one
/// call, so a fill affects every current follower at once (same fact
/// documented on CopyVault.sol's RiskParams and TraderRegistry's
/// followMultiple). notifyCopy therefore fans out to every wallet
/// TraderRegistry.getFollowers(traderId) returns, each independently opted
/// in/out and thresholded. That view function is being added in the same
/// contract batch as Feature 16 (contracts/src/TraderRegistry.sol) — until
/// that redeploy lands, callers here will get an empty followers list and
/// this correctly sends nothing rather than guessing a recipient.

function formatQuantity(raw: bigint): string {
  // Raw on-chain units, matching this project's existing convention
  // elsewhere (see indexer/src/executor.ts's own logging) — the WS
  // schema's exact decimal scaling is unverified (see detector.ts), so
  // this deliberately doesn't invent a "human" formatting here.
  return raw.toString();
}

export async function notifyCopy(trade: TradeEvent, followers: string[]): Promise<void> {
  const side = trade.isBid ? "BUY" : "SELL";
  const quantityStr = formatQuantity(trade.quantity);

  await Promise.all(
    followers.map(async (wallet) => {
      const prefs = await getNotificationPrefs(wallet);
      if (!prefs.telegram_chat_id || !prefs.notify_on_copy) return;
      if (Number(trade.quantity) < prefs.min_trade_size) return;

      const text = `✅ Copy: ${trade.traderAddress} ${trade.marketId} ${side} ${quantityStr} @ market`;
      await sendTelegramMessage(prefs.telegram_chat_id, text);
    }),
  );
}

export async function notifyStopLoss(traderLabelOrAddress: string, followers: string[]): Promise<void> {
  await Promise.all(
    followers.map(async (wallet) => {
      const prefs = await getNotificationPrefs(wallet);
      if (!prefs.telegram_chat_id || !prefs.notify_on_stop_loss) return;

      const text = `🛑 Stop-loss: Auto-paused ${traderLabelOrAddress} — loss limit hit`;
      await sendTelegramMessage(prefs.telegram_chat_id, text);
    }),
  );
}

/// Referral earnings have a genuine single recipient (the referrer) — no
/// fan-out ambiguity here, unlike notifyCopy/notifyStopLoss.
export async function notifyReferral(referrerWallet: string, amountRaw: bigint, symbol = "USDso"): Promise<void> {
  const prefs = await getNotificationPrefs(referrerWallet);
  if (!prefs.telegram_chat_id || !prefs.notify_on_referral) return;

  const text = `🎁 Referral: New referral — earned ${amountRaw.toString()} ${symbol}`;
  await sendTelegramMessage(prefs.telegram_chat_id, text);
}

// Polling window kept comfortably under this RPC's confirmed 1000-block
// eth_getLogs cap (see docs/README.md's Known Issues — the chain is
// already past block 475M, so "from genesis" is never an option here).
const REFERRAL_POLL_WINDOW_BLOCKS = 900;
const REFERRAL_POLL_INTERVAL_MS = 30_000;

/// Polls for new ReferralRegistered events and notifies each referrer.
/// There's no WS/webhook path for on-chain events in this indexer (only
/// DreamDEX fills are streamed, via detector.ts's WS connection) — a
/// periodic queryFilter is the simplest correct approach here, and cheap:
/// referrals are rare relative to trade volume.
export function startReferralWatcher(): void {
  let fromBlock: number | null = null;

  const poll = async () => {
    try {
      const latest = await provider.getBlockNumber();
      if (fromBlock === null) {
        fromBlock = Math.max(0, latest - REFERRAL_POLL_WINDOW_BLOCKS);
      }
      const toBlock = Math.min(latest, fromBlock + REFERRAL_POLL_WINDOW_BLOCKS);

      const events = await referralRegistry.queryFilter(
        referralRegistry.filters.ReferralRegistered(),
        fromBlock,
        toBlock,
      );

      for (const event of events) {
        if (!("args" in event) || !event.args) continue;
        const { referrer, feeAmount } = event.args as unknown as { referrer: string; feeAmount: bigint };
        console.log(`[notifications] new referral for ${referrer}, fee ${feeAmount.toString()}`);
        await notifyReferral(referrer, feeAmount);
      }

      fromBlock = toBlock + 1;
    } catch (err) {
      console.error("[notifications] referral watcher poll failed:", err);
    }
  };

  void poll();
  setInterval(poll, REFERRAL_POLL_INTERVAL_MS).unref?.();
}
