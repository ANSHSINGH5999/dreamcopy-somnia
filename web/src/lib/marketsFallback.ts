import type { DreamDEXMarket } from "./dreamdex";

/// Last-resort fallback for GET /v0/markets when the live DreamDEX staging
/// API is unreachable (it has been, for this entire project's build — see
/// docs/ARCHITECTURE.md). This is NOT a guess: every address matches
/// docs/ARCHITECTURE.md's independently-verified table, and every
/// tick/lot/min-quantity and decimals value below was cross-checked against
/// the live, deployed pool contracts directly (`getPoolParams()` on each
/// pool, `decimals()` on each token) — not trusted blindly. Re-verify this
/// file if any of these contracts are ever redeployed.
///
/// Always tagged `_source: "fallback"` (see route.ts) so callers can — and
/// must — disclose to the user that this isn't live data, per this
/// project's rule against silently presenting stale/static data as current.
export const MARKETS_FALLBACK: { markets: DreamDEXMarket[]; _source: "fallback" } = {
  markets: [
    {
      symbol: "SOMI:USDso",
      contract: "0x259fD6559214dd5aD3752322426eA9F9fABEFff4",
      base: "0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00",
      baseDecimals: 18,
      quote: "0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171",
      quoteDecimals: 18,
      kind: "spot",
      tickSize: "0.0001",
      lotSize: "0.01",
      minQuantity: "1",
    },
    {
      symbol: "WBTC:USDso",
      contract: "0x3605f28aA7C50e7441211e77Cb0762d49539326C",
      base: "0x4e85DC48a70DA1298489d5B6FC2492767d98f384",
      baseDecimals: 8,
      quote: "0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171",
      quoteDecimals: 18,
      kind: "spot",
      tickSize: "0.1",
      lotSize: "0.00001",
      minQuantity: "0.0001",
    },
    {
      symbol: "WETH:USDso",
      contract: "0xD180195da5459C7a0DEA188ed61216ec43682b50",
      base: "0x4d8E02BBfCf205828A8352Af4376b165E123D7b0",
      baseDecimals: 18,
      quote: "0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171",
      quoteDecimals: 18,
      kind: "spot",
      tickSize: "0.01",
      lotSize: "0.0001",
      minQuantity: "0.001",
    },
  ],
  _source: "fallback",
};
