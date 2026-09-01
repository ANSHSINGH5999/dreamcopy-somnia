# DreamCopy — Known Limitations & Design Decisions

This document exists because rule 6 of this project requires it: where
DreamDEX behavior was unclear or under-specified, contracts must revert with
a clear error rather than guess, and the reasoning must be written down here.
Everything below was checked against the real, live artifacts — not assumed:

- The real `dreamdex-bot-kit` repo (https://github.com/somnia-chain/dreamdex-bot-kit),
  specifically `packages/core/src/contract.ts`, `execute.ts`, `gotchas.ts`,
  and `config/tokens.ts`.
- A live `curl` of `GET https://stg.api.dreamdex.io/v0/markets` on
  2026-08-30, which returned 3 markets: `SOMI:USDso`, `WBTC:USDso`,
  `WETH:USDso`.
- A Foundry fork test (`contracts/test/CopyVault.fork.t.sol`) that calls
  `getPoolParams()` and `getAutoPullRequirement()` on the real, deployed
  WETH:USDso pool contract on Somnia testnet and asserts the results —
  proof `IDreamDEXPool.sol`'s ABI matches the live bytecode, not just the
  bot-kit's TypeScript types.

## 1. Collateral is an ERC-20 (USDso), not native STT

The project brief describes followers depositing "STT collateral." The real
market data contradicts a literal reading of that: every DreamDEX spot
market's quote side is `USDso`, an ERC-20
(`0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171` on testnet), not native STT.
Native STT/SOMI only appears as the *base* side of the `SOMI:USDso` pool
(`getAutoPullRequirement` returns a sentinel address there — see
`packages/core/src/config/tokens.ts`, `NATIVE_SENTINEL`), and buying/selling
that pool's base is a fundamentally different funding path than every other
market (native `msg.value` for a BUY, native payout with a documented
`5_000_000` gas floor in the bot-kit for a native BUY, "native BASE SELL"
requiring the vault to sell an asset it can't hold as an ERC-20 balance).

**Decision:** `CopyVault` is deployed with a single ERC-20
`collateralToken` (set at deploy time to the live `USDso` address, fetched
from `/v0/markets` — never hard-coded in source). This is the one collateral
token common to every listed market, so it's practically "the" trading
collateral for this DEX. `executeCopy` reverts with
`NativeSettlementNotSupported()` whenever `getAutoPullRequirement` returns
the native sentinel as the input token for an order — i.e. any attempt to
**sell native SOMI** on the `SOMI:USDso` pool. Buying `SOMI:USDso` (bidding
with USDso, receiving native SOMI as output) is not explicitly blocked by
that check today, but note it will leave the vault holding a native-STT
balance that the rest of the contract's ERC-20-balance bookkeeping
(`tokenBalance[traderId][token]`) does not model correctly for a token this way — **do not
approve the `SOMI:USDso` pool via `setApprovedPool` until native-asset
accounting is added.** The two ERC-20/ERC-20 markets (`WBTC:USDso`,
`WETH:USDso`) are fully supported today.

## 2. No price oracle — NAV is cost-basis, not mark-to-market

`CopyVault` shares are priced off `poolNav = idle collateral + tracked cost
basis of the pool's open position`, not a live oracle price. Concretely:

- Buying increases `deployedCostBasis` by exactly what was spent.
- Selling releases a proportional slice of `deployedCostBasis` and the
  difference between what's released and what's received is realized P&L —
  which shows up automatically as idle collateral, immediately
  withdrawable.
- **Unrealized P&L on an open position is invisible to NAV.** If a trader's
  copied WETH position doubles in value while still open, depositors joining
  *after* that point still buy in at the pre-rally NAV, diluting existing
  holders' unrealized (but not yet realized) gain. This is a real economic
  gap, not a display bug — it exists because there is no on-chain price feed
  for DreamDEX markets in the information available to build this project,
  and fabricating one (e.g. trusting the executor's self-reported price) would
  reintroduce exactly the custodial trust this project is supposed to avoid.
- **Mitigation implemented:** `withdraw()` only ever pays out of *idle*
  collateral, never at a fabricated NAV for the deployed portion — so no one
  can be paid out more than the pool actually, verifiably holds.
- The frontend's portfolio page should surface open-position mark price
  (readable from `getBookLevels`/live orderbook) as a clearly-labeled
  *estimate*, separately from the on-chain, oracle-free NAV figure.

## 3. Cost basis is tracked per trader pool, not per open position

If a trader pool has two concurrent open positions (say, both `WBTC:USDso`
and `WETH:USDso` open at once), `deployedCostBasis[traderId]` is a single
aggregate number, not tracked per-market. A partial close of one position
releases cost basis proportionally to the aggregate, not to that specific
position's actual entry price. In practice this only produces a materially
wrong number if a trader pool runs multiple concurrent unrelated positions
with very different unrealized P&L — a real scenario, flagged here rather
than hidden. Per-position (per-`(traderId, pool)`) cost basis tracking is the
natural extension if this becomes a problem in practice.

## 4. `placeOrderFor` / operator (split-key) mode was not used

The real bot-kit exposes a second, arguably more "official" pattern for
bot-driven trading: a user deposits into the DreamDEX pool's own internal
vault, enables `setManualVaultMode(true)`, and authorizes an operator
address via `OperatorPermissionsRegistry.setOperatorApprovalForPool(...)` to
call `placeOrderFor(owner, ...)` — "no allowance or msg.value: the operator
never holds funds" (verified from `packages/core/src/contract.ts`).

**Why CopyVault doesn't use this:** that pattern authorizes the operator
address itself (an EOA — the indexer's hot wallet) to place *any* order for
the owner, with no on-chain sizing/pool-balance/allow-listed-pool
constraints — the constraints CopyVault enforces
(`isApprovedPool`, `tokenBalance[traderId][...]` sufficiency, revert on
native settlement, cost-basis accounting) all live in `CopyVault.sol`'s own
logic, which only runs if `CopyVault` itself is the caller of `placeOrder`.
Under the operator pattern, none of that logic would run — the operator key
would have unconstrained trade authority over the owner's DreamDEX vault
balance directly. CopyVault's direct-funding design (`executeCopy` calling
`placeOrder` with `CopyVault` itself as `msg.sender`, after its own checks)
keeps every trade constrained by on-chain logic instead of by the trust
placed in the indexer's key alone. The trade-off: CopyVault holds
`approve()`-based allowances at trade time rather than the pool's own
internal vault balance — functionally equivalent from DreamDEX's point of
view, since `placeOrder`'s auto-pull already supports both.

## 5. Trust model: the `executor` key can trade, never withdraw

`executeCopy` is gated by a single `executor` address (owner-settable). This
key can trigger trades using pooled follower funds — sizing, timing, and
direction are entirely its choice, constrained only by the `isApprovedPool`
allow-list and each pool's own available balance. It **cannot** call
`withdraw()` on anyone else's behalf and cannot redirect funds anywhere but
into a `setApprovedPool`-approved DreamDEX pool contract, which itself can
only ever return funds to `CopyVault`'s own address (a DreamDEX pool has no
way to send tokens anywhere else on `CopyVault`'s behalf). If the executor
key is compromised, the attacker can force the vault to execute money-losing
trades (bad prices, wrong side, churn to eat fees) but cannot directly
steal principal to an external address. This is the actual meaning of
"non-custodial" this project claims — not "the operator can't affect your
money," but "the operator can't take your money." Document this plainly to
users; it is a materially weaker guarantee than a pure self-custody wallet.

## 6. `builder` / `builderFeeBpsTimes1k` are hard-coded to zero/`address(0)`

`executeCopy` always calls `placeOrder` with `builder = address(0)` and
`builderFeeBpsTimes1k = 0`. The bot-kit's own `assertBuilderDisabled` guard
(`packages/core/src/gotchas.ts`) suggests non-zero builder fees are, at
minimum, an advanced/conditional feature whose exact semantics (who
receives the fee, whether it's additive to the taker fee, whether it's
supported on every pool) weren't confirmed against the live contract. Rather
than guess, DreamCopy never sets a builder fee. This can be revisited once
DreamDEX's builder-fee semantics are confirmed directly.

## 7. Partial IOC fills are handled via balance-delta accounting, not the `delta` return value

`getAutoPullRequirement` returns a third value, `delta`, whose exact meaning
(refundable buffer? slippage headroom?) is not documented in the artifacts
this project had access to. `CopyVault.executeCopy` ignores it entirely and
instead measures the *actual* token balance change across the `placeOrder`
call (before/after `balanceOf`) to determine real spend and real proceeds.
This is provably correct regardless of what `delta` means, and it is exactly
the technique the bot-kit itself recommends for reading real fill results
("read the real orderId from the receipt, NOT from the simulation — ids can
drift"), applied to amounts instead of order IDs.

## 8. Explorer contract verification

`forge verify-contract` was not run against the Shannon explorer
(`https://shannon-explorer.somnia.network`) as part of this build — its
Blockscout-compatibility and exact verification API were not confirmed. Once
contracts are deployed, verify manually via the explorer's UI, or confirm
the API first with `forge verify-contract --verifier blockscout
--verifier-url https://shannon-explorer.somnia.network/api ...` before
scripting it.
