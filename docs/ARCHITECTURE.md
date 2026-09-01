# DreamCopy — Architecture

## Verified network & API facts (checked 2026-08-30)

| Fact | Value | Verified via |
|---|---|---|
| Testnet chain ID | `50312` | Independent web search (Somnia's own announcement) + this project's live RPC calls |
| Testnet RPC | `https://dream-rpc.somnia.network` | Same |
| Explorer | `https://shannon-explorer.somnia.network` | Same |
| DreamDEX REST base | `https://stg.api.dreamdex.io/v0` | Live `curl GET /v0/markets` returned real market data |
| DreamDEX WS | `wss://stg.api.dreamdex.io/v0/ws/public` | `dreamdex-bot-kit` source (`packages/core`) |
| Bot-kit repo | `https://github.com/somnia-chain/dreamdex-bot-kit` | Cloned and read directly |
| `placeOrder` ABI | See `contracts/src/interfaces/IDreamDEX.sol` | Cloned repo's `packages/core/src/contract.ts` (`SPOT_POOL_ABI`), **and** a Foundry fork test (`contracts/test/CopyVault.fork.t.sol`) that calls the live deployed WETH:USDso pool and asserts the decode succeeds |

Live testnet markets as of the same `curl` (`contract` = SpotPool address):

| Symbol | Pool contract | Base | Quote (USDso, every pool) |
|---|---|---|---|
| SOMI:USDso | `0x259fD6559214dd5aD3752322426eA9F9fABEFff4` | native SOMI (sentinel `0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00`) | `0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171` |
| WBTC:USDso | `0x3605f28aA7C50e7441211e77Cb0762d49539326C` | `0x4e85DC48a70DA1298489d5B6FC2492767d98f384` | same |
| WETH:USDso | `0xD180195da5459C7a0DEA188ed61216ec43682b50` | `0x4d8E02BBfCf205828A8352Af4376b165E123D7b0` | same |

**These addresses are recorded here for reference/documentation only.** Every
runtime code path (contracts' `setApprovedPool` admin calls, the indexer)
fetches them fresh from `GET /v0/markets` — nothing in `src/` hard-codes a
pool address. See `docs/LIMITATIONS.md` for why the `SOMI:USDso` pool isn't
supported yet.

## System flow

```
follower wallet ──deposit(traderId, amount)──► CopyVault (holds USDso, per-traderId pools)
follower wallet ──follow(traderId)──► TraderRegistry

trader wallet ──places real order──► DreamDEX SpotPool (WETH:USDso / WBTC:USDso)
                                            │
                                            │ OrderFilled event
                                            ▼
                                   indexer/detector.ts (WS subscriber)
                                            │ sizes the copy trade off-chain
                                            ▼
                                   indexer/executor.ts
                                            │ CopyVault.executeCopy(traderId, pool, ...)
                                            ▼
                                   CopyVault ──approve + placeOrder──► DreamDEX SpotPool
                                            │ balance-delta accounting
                                            ▼
                              tokenBalance[traderId][...] / deployedCostBasis[traderId] updated

follower wallet ──withdraw(traderId, shares)──► CopyVault (pays out of idle USDso only)
```

## Contracts (this batch)

- **`CopyTypes.sol`** — shared `Trader` struct and `TraderNotFound` /
  `TraderInactive` errors used by both contracts below.
- **`interfaces/IDreamDEX.sol`** — `IDreamDEXPool`, the verified DreamDEX
  SpotPool ABI, plus the native-sentinel constant and `orderType` /
  `selfMatchingOption` enums (all sourced from the real bot-kit — see the
  table above).
- **`TraderRegistry.sol`** — permissionless trader self-registration,
  follow/unfollow, active/inactive gating. No funds ever touch this
  contract.
- **`CopyVault.sol`** — the non-custodial pooled vault. One deployment
  covers every trader (partitioned internally by `traderId`); collateral is
  a single ERC-20 (`USDso` on testnet — see `docs/LIMITATIONS.md` §1).
  `executeCopy` is the only way funds move into/out of a DreamDEX trade,
  gated to a single `executor` address that can trade but never withdraw
  (see `docs/LIMITATIONS.md` §5).

## Testing

- `contracts/test/TraderRegistry.t.sol`, `contracts/test/CopyVault.t.sol` —
  unit tests against `test/mocks/MockDreamDEXPool.sol` (a hand-written
  double implementing the real `IDreamDEXPool` interface). Covers every
  external function, every custom error, and the full economic round-trip
  (deposit → copy buy → copy sell at a profit → proportional withdraw across
  two followers).
- `contracts/test/CopyVault.fork.t.sol` — forks live Somnia testnet and
  calls `getPoolParams()` / `getAutoPullRequirement()` on the real,
  deployed WETH:USDso pool, asserting the results match the live
  `/v0/markets` response. This is what proves `IDreamDEXPool.sol` isn't
  just a transcription of some TypeScript — it matches the actual deployed
  bytecode.

Run everything:

```bash
cd dreamcopy/contracts
forge test              # unit + fork (fork test needs network access)
forge test --no-match-path 'test/*.fork.t.sol'   # fast, fully offline
```

## Deployment

```bash
cd dreamcopy/contracts
export PRIVATE_KEY=0x...                # deployer key, funded with testnet STT
export EXECUTOR_ADDRESS=0x...           # indexer's hot wallet
export OWNER_ADDRESS=0x...              # admin (e.g. your own wallet, or a multisig later)
# Fetch this from `curl https://stg.api.dreamdex.io/v0/markets` — the
# `quote` field, currently USDso on every market. Do not hard-code it here
# from memory; re-fetch before every deploy in case it changes.
export COLLATERAL_TOKEN=0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171

forge script script/Deploy.s.sol --rpc-url somnia_testnet --broadcast
```

After deploying, allow-list the pools you intend to trade (owner-only —
addresses re-fetched from `/v0/markets`, not hard-coded):

```bash
cast send $COPY_VAULT_ADDRESS "setApprovedPool(address,bool)" $WETH_USDSO_POOL true \
  --rpc-url somnia_testnet --private-key $OWNER_PRIVATE_KEY
```
