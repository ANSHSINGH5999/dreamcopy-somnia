-- copy_trades: one row per executeCopy attempt (success, on-chain failure, or
-- pre-flight skip). Written by the indexer (indexer/src/supabase.ts) using
-- the project's secret key, which bypasses RLS. Read by the web frontend
-- (web/src/lib/supabase.ts) using the publishable key — RLS below only
-- grants that key SELECT, never INSERT/UPDATE/DELETE.
--
-- `follower` is deliberately nullable and left NULL by the indexer:
-- CopyVault.executeCopy() has no follower parameter — it trades the entire
-- pooled balance for a traderId in one call, affecting every current
-- follower proportionally. There is no single "the follower" for a given
-- trade to record here. The frontend instead filters by which trader_ids
-- the connected wallet currently follows on-chain (see PortfolioTradeHistory
-- in web/src/app/portfolio/page.tsx).
create table if not exists copy_trades (
  id uuid primary key default gen_random_uuid(),
  trader_id bigint not null,
  follower text,
  market text not null,
  is_bid boolean not null,
  quantity text not null,
  price text not null,
  tx_hash text,
  status text not null check (status in ('success', 'failed', 'skipped')),
  skip_reason text,
  created_at timestamptz not null default now()
);

create index if not exists copy_trades_trader_id_idx on copy_trades (trader_id);
create index if not exists copy_trades_created_at_idx on copy_trades (created_at desc);
create index if not exists copy_trades_status_idx on copy_trades (status);

alter table copy_trades enable row level security;

-- Public read (activity logs only, per the project's stated DB purpose —
-- nothing sensitive lives here: no balances, no keys, no PII).
drop policy if exists "copy_trades_public_read" on copy_trades;
create policy "copy_trades_public_read" on copy_trades
  for select
  using (true);

-- No insert/update/delete policy is created for anon/publishable — only the
-- secret key (which bypasses RLS entirely) can write, i.e. only the indexer.

-- Enable Realtime (INSERT events) on copy_trades — powers the home page's
-- live activity feed (web/src/components/ActivityFeed.tsx). Guarded so
-- re-running this file is safe even if already enabled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'copy_trades'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE copy_trades;
  END IF;
END $$;

-- notification_prefs: one row per wallet, read by the indexer
-- (indexer/src/notifications.ts) before every send. Written ONLY through
-- web/src/app/api/notify/prefs/route.ts using the secret key, server-side —
-- deliberately NOT writable by the publishable key. This app has no
-- wallet-signature auth binding a connected address to a Postgres role, so
-- a permissive client-side write policy keyed on a plain `wallet` text
-- column would let anyone overwrite anyone else's telegram_chat_id/prefs.
-- Routing writes through a server API closes that gap; RLS below denies
-- every anon/publishable operation, including SELECT (also read only via
-- that same API's GET, never directly by the browser).
create table if not exists notification_prefs (
  wallet text primary key,
  telegram_chat_id text,
  notify_on_copy boolean not null default true,
  notify_on_stop_loss boolean not null default true,
  notify_on_referral boolean not null default true,
  min_trade_size numeric not null default 0
);

alter table notification_prefs enable row level security;
-- No policies created at all: RLS with zero policies denies every
-- operation to anon/publishable by default. Only the secret key (which
-- bypasses RLS) can read or write this table.

-- simulations: "paper trading" — a wallet picks a trader and a virtual
-- deposit size, and the indexer (indexer/src/simulation.ts) updates
-- virtual_pnl/trade_count as that trader's real fills come in, scaled to
-- virtual_deposit exactly like a real follower pool would be (see
-- indexer/src/executor.ts's computeFollowerQuantity — same ratio, applied
-- to an off-chain ledger instead of an on-chain vault). No real funds are
-- ever involved.
--
-- virtual_cost_basis is NOT in the original feature spec's schema — added
-- because virtual P&L can't be computed on a later "sell" without tracking
-- what was virtually "bought" first (mirrors CopyVault.deployedCostBasis
-- exactly, just for an off-chain position). Documented here rather than
-- silently added.
create table if not exists simulations (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  trader_id integer not null,
  virtual_deposit numeric not null,
  virtual_pnl numeric not null default 0,
  virtual_cost_basis numeric not null default 0,
  -- Also not in the original spec: needed alongside virtual_cost_basis to
  -- replicate CopyVault.executeCopy's exact proportional-release formula
  -- (basisReleased = costBasis * inputSpent / baseHeldBefore) — without
  -- this, a sell can't correctly release only ITS share of cost basis.
  virtual_base_held numeric not null default 0,
  trade_count integer not null default 0,
  started_at timestamptz not null default now()
);

create index if not exists simulations_wallet_idx on simulations (wallet);
create index if not exists simulations_trader_id_idx on simulations (trader_id);

alter table simulations enable row level security;

-- Public read (own wallet filtering happens client-side — nothing
-- sensitive here, no real funds, same activity-log trust level as
-- copy_trades).
drop policy if exists "simulations_public_read" on simulations;
create policy "simulations_public_read" on simulations
  for select
  using (true);

-- Public INSERT (starting a simulation is harmless — worst case is spam
-- rows of fake money) but deliberately NO UPDATE policy: only the secret
-- key (indexer) can move virtual_pnl/trade_count, so a user can't just
-- edit their own virtual P&L to whatever they want via a direct client
-- write. Contrast notification_prefs, where even INSERT/UPDATE is denied
-- to anon because writing there can affect where a REAL other wallet's
-- notifications go.
drop policy if exists "simulations_public_insert" on simulations;
create policy "simulations_public_insert" on simulations
  for insert
  with check (true);

-- whale_alerts: one row per trader fill whose USDso notional clears
-- indexer/src/whaleAlert.ts's WHALE_THRESHOLD_USDSO, written by the indexer
-- (secret key) right after it's detected — independent of whether our vault
-- actually mirrors the trade (see whaleAlert.ts's header comment, same
-- independence as simulations). Read by the web frontend via Realtime to
-- drive a global banner (web/src/components/WhaleAlertBanner.tsx). Public,
-- read-only, same activity-log trust level as copy_trades — no PII, no
-- balances, no keys.
--
-- `quantity` stores the USDso notional (price*quantity/1e18), not the raw
-- base-token quantity — matches what's shown in the Telegram alert and the
-- banner, and there's no separate notional column in this table.
create table if not exists whale_alerts (
  id uuid primary key default gen_random_uuid(),
  trader_id integer not null,
  trader_label text not null,
  market_symbol text not null,
  is_bid boolean not null,
  quantity numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists whale_alerts_created_at_idx on whale_alerts (created_at desc);

alter table whale_alerts enable row level security;

drop policy if exists "whale_alerts_public_read" on whale_alerts;
create policy "whale_alerts_public_read" on whale_alerts
  for select
  using (true);

-- No insert/update/delete policy for anon/publishable — only the secret key
-- (the indexer) can write, same pattern as copy_trades.

-- Enable Realtime (INSERT events) on whale_alerts — powers the global whale
-- alert banner. Guarded so re-running this file is safe even if already
-- enabled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'whale_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE whale_alerts;
  END IF;
END $$;
