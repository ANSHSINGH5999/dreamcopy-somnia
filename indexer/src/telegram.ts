import { config } from "./config.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";

/// Low-level transport: sends `text` to `chatId` via the Bot API. Never
/// throws — notification failures must never crash the indexer or block a
/// trade from being considered "done" on-chain. Returns whether it actually
/// sent, so callers (e.g. the /api/notify/test route's underlying check)
/// can distinguish "sent" from "silently skipped, not configured".
export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!config.telegramBotToken) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN not set — skipping notification");
    return false;
  }
  if (!chatId) {
    return false;
  }
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[telegram] sendMessage failed: ${res.status} ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[telegram] sendMessage threw:", err);
    return false;
  }
}

/// Operator-level alert (indexer errors, not user-facing trade
/// notifications — those go through notifications.ts instead) — sent to
/// the single global chat configured in indexer/.env, if any.
export async function notifyOperator(text: string): Promise<void> {
  if (!config.telegramChatId) return;
  await sendTelegramMessage(config.telegramChatId, `⚠️ ${text}`);
}

/// Public whale-alert broadcast (see whaleAlert.ts) — sent to the same
/// global chat as notifyOperator, but this is market info for anyone
/// watching, not an operator error, hence the different framing/emoji and
/// its own function rather than reusing notifyOperator.
export async function notifyWhale(text: string): Promise<void> {
  if (!config.telegramChatId) return;
  await sendTelegramMessage(config.telegramChatId, text);
}
