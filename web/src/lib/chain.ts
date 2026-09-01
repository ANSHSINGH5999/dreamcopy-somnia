import { defineChain } from "viem";

// Somnia Testnet (Shannon). Verified against independent sources and this
// project's own live RPC/API calls on 2026-08-30 — see
// dreamcopy/docs/ARCHITECTURE.md for the verification trail.
export const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: {
    name: "Somnia Test Token",
    symbol: "STT",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_SOMNIA_RPC_URL ?? "https://dream-rpc.somnia.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Shannon Explorer",
      url: "https://shannon-explorer.somnia.network",
    },
  },
  testnet: true,
});

export const DREAMDEX_REST_BASE =
  process.env.NEXT_PUBLIC_DREAMDEX_REST_BASE ?? "https://stg.api.dreamdex.io/v0";
export const DREAMDEX_WS_URL =
  process.env.NEXT_PUBLIC_DREAMDEX_WS_URL ?? "wss://stg.api.dreamdex.io/v0/ws/public";
