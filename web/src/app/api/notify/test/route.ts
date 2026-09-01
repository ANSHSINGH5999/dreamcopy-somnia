import { NextResponse } from "next/server";

const TELEGRAM_API_BASE = "https://api.telegram.org";

/// POST /api/notify/test — sends a test Telegram message to the given
/// chat_id, using the server-only TELEGRAM_BOT_TOKEN (never exposed to the
/// browser). Mirrors indexer/src/telegram.ts's sendTelegramMessage, kept
/// separate since this route runs in the Next.js server, not the indexer
/// process.
export async function POST(req: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!botToken) {
    return NextResponse.json({ success: false, error: "TELEGRAM_BOT_TOKEN not configured on the server" }, { status: 503 });
  }

  let body: { chat_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid JSON body" }, { status: 400 });
  }

  const chatId = body.chat_id?.trim() ?? "";
  if (!chatId) {
    return NextResponse.json({ success: false, error: "chat_id is required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "✅ DreamCopy test notification — your Telegram chat ID is configured correctly.",
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ success: false, error: `Telegram API returned ${res.status}: ${detail}` }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
