import { EventEmitter } from "node:events";
import { getAddress, isAddress } from "ethers";
import { config } from "./config.js";
import { traderRegistry } from "./contracts.js";
import type { TradeEvent } from "./types.js";

/// ─────────────────────────────────────────────────────────────────────────
/// ⚠️  UNVERIFIED SCHEMA — read before trusting this in production
///
/// This project has no confirmed message schema for
/// wss://stg.api.dreamdex.io/v0/ws/public. Three independent attempts to get
/// one all failed in the session that wrote this file:
///   1. Connecting to the WS URL directly from this environment — TLS/conn
///      reset, same as the REST API (see docs/ARCHITECTURE.md).
///   2. The user's own machine — same endpoint, also unreachable.
///   3. Reading `dreamdex-bot-kit` (packages/core/src/contract.ts etc.,
///      the source ARCHITECTURE.md cites for the WS URL itself) — the repo
///      does not exist anywhere on this machine.
///
/// This project's own established rule for exactly this situation is: don't
/// invent a fixed shape for unverified DreamDEX data and risk silently
/// misreading it — see `fetchOrderbooksRaw` in web/src/lib/dreamdex.ts and
/// docs/LIMITATIONS.md's requirement to document, not guess, undefined
/// behavior. `parseTradeEvent` below follows that: it tries several
/// plausible field names seen on typical exchange feeds, and returns `null`
/// — logging the raw message — for anything it can't confidently map,
/// rather than fabricating trade data that would flow straight into
/// CopyVault.executeCopy (a fund-moving call).
///
/// Before relying on this indexer with real trades:
///   1. Get the WS connection reachable (network fix, or run this indexer
///      somewhere that can reach stg.api.dreamdex.io).
///   2. Set LOG_RAW_MESSAGES=1 in indexer/.env and run `npm start` while a
///      followed trader is active on DreamDEX, to capture one real message.
///   3. Fix parseTradeEvent's field names (and the subscribe handshake in
///      `connect()`, if the feed turns out to need one) to match.
/// ─────────────────────────────────────────────────────────────────────────

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/// Best-effort extraction of a trade/fill event from a raw DreamDEX WS
/// message. See the header comment above — this is UNVERIFIED against a
/// real payload. Returns null (and the caller logs) for anything it can't
/// confidently parse as a trade.
export function parseTradeEvent(raw: unknown): TradeEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as Record<string, unknown>;

  // Unwrap common envelope shapes: {type, data}, {event, payload}, or a bare object.
  const bodyCandidate = msg.data ?? msg.payload ?? msg;
  if (typeof bodyCandidate !== "object" || bodyCandidate === null) return null;
  const body = bodyCandidate as Record<string, unknown>;

  const typeField = String(msg.type ?? msg.event ?? msg.channel ?? "").toLowerCase();
  if (typeField && !/trade|fill|order.?exec|match/.test(typeField)) {
    // Explicitly not trade-shaped (heartbeat, orderbook diff, subscription ack, ...).
    return null;
  }

  const traderAddressRaw =
    body.trader ?? body.traderAddress ?? body.owner ?? body.wallet ?? body.account ?? body.maker ?? body.taker;
  const marketIdRaw = body.marketId ?? body.symbol ?? body.market ?? body.pool ?? body.contract;
  const isBidRaw = body.isBid ?? body.side ?? body.direction;
  const priceRaw = body.price;
  const quantityRaw = body.quantity ?? body.qty ?? body.size ?? body.amount;

  if (typeof traderAddressRaw !== "string" || !isAddress(traderAddressRaw)) return null;
  if (marketIdRaw === undefined || priceRaw === undefined || quantityRaw === undefined) return null;

  let isBid: boolean;
  if (typeof isBidRaw === "boolean") {
    isBid = isBidRaw;
  } else if (typeof isBidRaw === "string") {
    if (/^(buy|bid|true)$/i.test(isBidRaw)) isBid = true;
    else if (/^(sell|ask|false)$/i.test(isBidRaw)) isBid = false;
    else return null;
  } else {
    return null;
  }

  let price: bigint;
  let quantity: bigint;
  try {
    price = BigInt(priceRaw as string | number | bigint);
    quantity = BigInt(quantityRaw as string | number | bigint);
  } catch {
    return null;
  }

  return {
    traderAddress: getAddress(traderAddressRaw) as `0x${string}`,
    marketId: String(marketIdRaw),
    isBid,
    price,
    quantity,
    raw,
  };
}

export interface DetectorEvents {
  trade: [trade: TradeEvent, traderId: bigint];
}

/// Connects to the DreamDEX public WS feed, watches for fills from
/// currently-followed (active) traders in TraderRegistry, and emits a
/// `"trade"` event for each one detected. Reconnects with exponential
/// backoff on any close/error.
export class Detector extends EventEmitter {
  private ws: WebSocket | null = null;
  private backoffMs = MIN_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  /// lowercased wallet address -> traderId, refreshed periodically.
  private watchedTraders = new Map<string, bigint>();

  async start(): Promise<void> {
    this.stopped = false;
    await this.refreshWatchedTraders();

    this.refreshTimer = setInterval(() => {
      this.refreshWatchedTraders().catch((err) => {
        console.error("[detector] failed to refresh trader list:", err);
      });
    }, config.traderRefreshMs);
    this.refreshTimer.unref?.();

    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.ws?.close();
    this.ws = null;
  }

  get watchedCount(): number {
    return this.watchedTraders.size;
  }

  private async refreshWatchedTraders(): Promise<void> {
    const count: bigint = await traderRegistry.traderCount();
    const next = new Map<string, bigint>();
    for (let id = 1n; id <= count; id++) {
      const trader = await traderRegistry.getTrader(id);
      if (trader.active) {
        next.set((trader.wallet as string).toLowerCase(), id);
      }
    }
    const added = [...next.keys()].filter((w) => !this.watchedTraders.has(w));
    this.watchedTraders = next;
    if (added.length > 0) {
      console.log(`[detector] now watching ${next.size} active trader(s): ${[...next.keys()].join(", ")}`);
    }
  }

  private connect(): void {
    if (this.stopped) return;

    console.log(`[detector] connecting to ${config.wsUrl} ...`);
    const ws = new WebSocket(config.wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      console.log("[detector] connected");
      this.backoffMs = MIN_BACKOFF_MS;
      if (config.wsSubscribeMessage) {
        ws.send(config.wsSubscribeMessage);
        console.log("[detector] sent subscribe message");
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      void this.handleRawMessage(event.data);
    };

    ws.onerror = (event: Event) => {
      // Node's WebSocket (undici) can surface an Error with an empty
      // `.message` for a bare connection reset — fall back to `.name` so the
      // log line is never a bare, unhelpful "websocket error: ".
      const err = (event as unknown as { error?: unknown }).error;
      const message = err instanceof Error ? err.message || err.name : String(err ?? "unknown");
      console.error(`[detector] websocket error: ${message}`);
    };

    ws.onclose = (event: CloseEvent) => {
      if (this.stopped) return;
      console.warn(
        `[detector] connection closed (code ${event.code}${event.reason ? `, reason: ${event.reason}` : ""}) ` +
          `— reconnecting in ${this.backoffMs}ms`,
      );
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const jitter = Math.floor(Math.random() * 250);
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs + jitter);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private async handleRawMessage(data: string | ArrayBuffer | Blob): Promise<void> {
    let text: string;
    if (typeof data === "string") {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(data);
    } else {
      text = await data.text();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return; // Not JSON (e.g. a ping frame) — ignore.
    }

    if (config.logRawMessages) {
      console.debug("[detector] raw message:", text);
    }

    const trade = parseTradeEvent(parsed);
    if (!trade) return;

    const traderId = this.watchedTraders.get(trade.traderAddress.toLowerCase());
    if (traderId === undefined) return; // Not a wallet we currently follow.

    console.log(
      `[detector] trade detected: trader=${trade.traderAddress} market=${trade.marketId} ` +
        `${trade.isBid ? "BUY" : "SELL"} qty=${trade.quantity} @ ${trade.price}`,
    );
    this.emit("trade", trade, traderId);
  }
}

export const detector = new Detector();
