
# DreamCopy

Non-custodial copy-trading for [DreamDEX](https://docs.dreamdex.io) on Somnia testnet (chain `50312`). Followers deposit collateral into a shared, share-based vault per trader; when a followed trader fills an order on DreamDEX, an off-chain indexer detects it and mirrors a proportionally-sized trade on-chain. Funds never leave the vault contract except back to the depositor.

> Read `docs/ARCHITECTURE.md` and `docs/LIMITATIONS.md` before changing contracts — they record what's verified against live sources (never assumed) and the deliberate scope cuts, with reasoning.

## Repo layout

```
dreamcopy/
├── contracts/   Solidity (Foundry) — TraderRegistry, CopyVault, ReferralRegistry
├── web/         Next.js frontend (wagmi/viem, RainbowKit, Tailwind)
├── indexer/     Node/TS service — WS detector → executor → Telegram/Supabase
└── docs/        ARCHITECTURE.md, LIMITATIONS.md, supabase_schema.sql
```

## Deployed contracts (Somnia testnet, chain 50312)

| Contract | Address |
|---|---|
| TraderRegistry | `0x3546Cb78A5077E62909Fdb3A1c9C1E7ce100F17C` |
| CopyVault | `0xD0C9CBB84f4aab73Ace1934A7A4BfCC0597cd21A` |
| ReferralRegistry | `0x649fcD52C8011088c47dD724Dd400D81a90B6fC0` |
| Collateral (USDso) | `0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171` |
| WBTC:USDso pool | `0x3605f28aA7C50e7441211e77Cb0762d49539326C` |
| WETH:USDso pool | `0xD180195da5459C7a0DEA188ed61216ec43682b50` |

RPC: `https://dream-rpc.somnia.network` · Explorer: `https://shannon-explorer.somnia.network`

These three contracts are wired together and must stay in sync if any one is redeployed:
`TraderRegistry.copyVault` → CopyVault, `CopyVault.registry` → TraderRegistry (immutable), `CopyVault.referralRegistry` → ReferralRegistry, `ReferralRegistry.copyVault` → CopyVault (immutable). See "Redeploying" below.

## Stack

- **Contracts:** Solidity `^0.8.24` + Foundry, OpenZeppelin (`Ownable`, `ReentrancyGuard`, `SafeERC20`)
- **Frontend:** Next.js (App Router) + wagmi v2 + RainbowKit + Tailwind CSS
- **Indexer:** Node.js + TypeScript + ethers.js v6
- **DB:** Supabase (`copy_trades` activity log — see Known Issues, not yet provisioned)

## Quick start

```bash
# Contracts
cd contracts
forge install          # if lib/ isn't already populated
forge test              # 84 tests, includes live fork tests against the pools above
forge test --no-match-path 'test/*.fork.t.sol'   # fast, fully offline

# Web
cd web
npm install
cp .env.local.example .env.local   # fill in addresses above if starting fresh
npm run dev                         # http://localhost:3000

# Indexer
cd indexer
npm install
cp .env.example .env               # PRIVATE_KEY is read from ../contracts/.env, not here
npm start
```

## Features implemented

- **Leaderboard** (`/traders`) — pure on-chain read (`TraderRegistry.traderCount` + `getTrader` loop), sortable by followers or win rate, 🏆 Verified / ⭐ Rising badges.
- **Multi-trader follow** — `TraderRegistry.followMultiple`, `CopyVault.setAllocations`/`getUserAllocations` (advisory allocation intent, doesn't move funds by itself).
- **Deposit flow** (`/follow`) — guided Approve → Follow → Deposit sequence (`DepositModal.tsx`), referral-aware via `depositWithReferral`.
- **Risk controls** — pool-wide (not per-follower — see Design Notes), owner-set `maxAllocationPct` / `maxLossPerTrade` / `pauseCopying` on `CopyVault`.
- **Stop-loss** — pool-wide cumulative realized-loss tracker; auto-triggers the same enforced pause as risk controls once a threshold is breached.
- **Trader performance badges** — `TraderRegistry.recordTradeResult`, called only on SELL fills (realized P&L; a BUY has no outcome to judge yet — no price oracle).
- **Pause/resume** (`/portfolio`) — personal, advisory-only per-follower preference; does not block the pool's shared trades (can't, mechanically — see Design Notes).
- **Referral system** (`/referral`, `/ref/[address]`) — 0.5% first-deposit fee, on-chain enumerable referrer leaderboard.
- **Trade history / Live Activity Feed** — Supabase `copy_trades` table, Realtime subscription on the home page. **Blocked** — see Known Issues.
- **Mobile-responsive UI** — hamburger nav drawer, card/table layout swap, bottom-sheet deposit modal, global 44px touch targets (`< 768px`).
- **`/api/markets` proxy** — 60s-cached live DreamDEX market data with a verified static fallback (tagged `_source`, shown to the user, never silently substituted) when the upstream API is unreachable.

**Not yet built:** Analytics Dashboard, Smart Notifications (`notification_prefs`), One-click Strategy Templates.

## Design notes worth knowing before extending this

`CopyVault.executeCopy` trades a trader's **entire pooled balance in one call** — there is no per-follower execution path, and no way to cheaply enumerate followers on-chain. This shows up repeatedly:

- **Risk controls / stop-loss are pool-wide**, owner-set circuit breakers — not a personal follower setting. A truly personal version would need to loop every follower with a setting inside `executeCopy` (unbounded gas) and would let one cautious follower block the trade for everyone else.
- **Pause/resume is the opposite tradeoff**: kept genuinely per-follower, but purely advisory (never enforced in `executeCopy`) — same pattern as `setAllocations`.
- **Badges only record on SELLs.** A BUY has no realized P&L; "won" is `outputReceived >= basisReleased`, checked once per sell.
- **`TraderRegistry` gained `Ownable` + a `copyVault` reference** solely so `recordTradeResult` can be gated to the real CopyVault contract, not the weaker "executor" wallet concept (which is independently reassignable and doesn't prove a call came from a completed trade).

## Known issues / open items

1. **Supabase is not provisioned.** `docs/supabase_schema.sql` needs to be run in the project's SQL Editor — the REST API currently exposes zero tables in `public`. Trade History and the Live Activity Feed render correct empty/error states but have no real data until this is done.
2. **DreamDEX WS feed schema is unverified.** `indexer/src/detector.ts` has never received a real payload (the staging WS endpoint has been unreachable throughout this build). `parseTradeEvent` defensively tries plausible field names and logs/skips anything it can't confidently map — see that file's header comment before trusting it with real trades.
3. **This RPC has real quirks**, learned the hard way during development — worth knowing if you deploy or write scripts against it again:
   - `eth_estimateGas` drastically undershoots real costs (contract deploys needed ~10x the naive estimate). Use an explicit `--gas-limit`, not `--gas-estimate-multiplier`.
   - Broadcast transactions are intermittently flaky independent of gas amount — a tx can fail burning its full gas limit, then an identical retry succeeds using a fraction of it.
   - `eth_getLogs` is capped at a 1000-block range, and the chain is already past block 475M — full-history event scanning from a client is not viable. (This is why `ReferralRegistry` maintains an on-chain `referrers` array instead of relying on `ReferralRegistered` logs.)
4. **No proportional position sizing yet in the indexer's executor** — trades mirror the trader's raw fill quantity 1:1 (capped by `maxAllocationPct` if set), not scaled to the follower pool's size relative to the trader's own capital.
5. **`forge verify-contract` has not been run** against the Shannon explorer for any of the three contracts.

## Redeploying

If you change `CopyVault.sol`, `TraderRegistry.sol`, or `ReferralRegistry.sol`, the dependency order is:

1. Deploy `TraderRegistry` (no constructor args).
2. Deploy `CopyVault(collateralToken, traderRegistry, executor, owner)`.
3. `TraderRegistry.setCopyVault(copyVault)` (owner-only).
4. Deploy `ReferralRegistry(collateralToken, copyVault)`.
5. `CopyVault.setReferralRegistry(referralRegistry)` (owner-only).
6. Re-register any traders, re-approve pools via `CopyVault.setApprovedPool`.
7. Update addresses in `web/.env.local`, `indexer/.env`, and the fallback defaults in `indexer/src/config.ts`.

Check `totalSharesOf` on the old `CopyVault` for every registered trader before redeploying — if it's non-zero, real deposits exist and a redeploy abandons them (this vault has no migration path).
## Presentation

A detailed project presentation is available in the repository: [Download Presentation](imp.pptx).

## License

MIT (contracts). See individual `package.json` files for frontend/indexer.
