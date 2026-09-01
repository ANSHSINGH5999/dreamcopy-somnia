// Addresses are deploy-time configuration, never hard-coded logic — set these
// once contracts are deployed via dreamcopy/contracts/script/Deploy.s.sol
// (see dreamcopy/docs/ARCHITECTURE.md). Left unset, pages that need them
// render a clear "not deployed" state instead of crashing or faking data.
export const TRADER_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_TRADER_REGISTRY_ADDRESS ?? "") as
  | `0x${string}`
  | "";
export const COPY_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_COPY_VAULT_ADDRESS ?? "") as `0x${string}` | "";
export const COLLATERAL_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_COLLATERAL_TOKEN_ADDRESS ?? "") as
  | `0x${string}`
  | "";
export const REFERRAL_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REFERRAL_REGISTRY_ADDRESS ?? "") as
  | `0x${string}`
  | "";

export const CONTRACTS_CONFIGURED = Boolean(TRADER_REGISTRY_ADDRESS && COPY_VAULT_ADDRESS);

// ABIs below mirror dreamcopy/contracts/src/TraderRegistry.sol and
// CopyVault.sol exactly (see those files — every entry here corresponds to a
// real, tested Solidity function/event, not a guess).

export const traderRegistryAbi = [
  {
    type: "function",
    name: "registerTrader",
    stateMutability: "nonpayable",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "traderId", type: "uint256" }],
  },
  {
    type: "function",
    name: "deactivateTrader",
    stateMutability: "nonpayable",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "reactivateTrader",
    stateMutability: "nonpayable",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "follow",
    stateMutability: "nonpayable",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "followMultiple",
    stateMutability: "nonpayable",
    inputs: [{ name: "traderIds", type: "uint256[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "unfollow",
    stateMutability: "nonpayable",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getTrader",
    stateMutability: "view",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "wallet", type: "address" },
          { name: "label", type: "string" },
          { name: "active", type: "bool" },
          { name: "followerCount", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "traderCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "traderIdByWallet",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isFollowing",
    stateMutability: "view",
    inputs: [
      { name: "traderId", type: "uint256" },
      { name: "follower", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getWinRate",
    stateMutability: "view",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [{ name: "pct", type: "uint256" }],
  },
  {
    type: "function",
    name: "performance",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "totalTrades", type: "uint256" },
      { name: "winningTrades", type: "uint256" },
      { name: "lastUpdated", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "traderPnL",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "realizedPnL", type: "int256" },
      { name: "totalVolume", type: "uint256" },
      { name: "bestTrade", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getFollowers",
    stateMutability: "view",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "event",
    name: "TraderRegistered",
    inputs: [
      { name: "traderId", type: "uint256", indexed: true },
      { name: "wallet", type: "address", indexed: true },
      { name: "label", type: "string", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Followed",
    inputs: [
      { name: "traderId", type: "uint256", indexed: true },
      { name: "follower", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Unfollowed",
    inputs: [
      { name: "traderId", type: "uint256", indexed: true },
      { name: "follower", type: "address", indexed: true },
    ],
    anonymous: false,
  },
] as const;

export const copyVaultAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "traderId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "traderId", type: "uint256" },
      { name: "shareAmount", type: "uint256" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "poolNav",
    stateMutability: "view",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSharesOf",
    stateMutability: "view",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "sharesOf",
    stateMutability: "view",
    inputs: [
      { name: "traderId", type: "uint256" },
      { name: "follower", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenBalance",
    stateMutability: "view",
    inputs: [
      { name: "traderId", type: "uint256" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "deployedCostBasis",
    stateMutability: "view",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "collateralToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "isApprovedPool",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setAllocations",
    stateMutability: "nonpayable",
    inputs: [
      { name: "traderIds", type: "uint256[]" },
      { name: "allocationPcts", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getUserAllocations",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "traderIds", type: "uint256[]" },
      { name: "allocationPcts", type: "uint256[]" },
    ],
  },
  {
    type: "function",
    name: "allocationPctOf",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setRiskParams",
    stateMutability: "nonpayable",
    inputs: [
      { name: "traderId", type: "uint256" },
      { name: "maxLossPerTrade", type: "uint256" },
      { name: "maxAllocationPct", type: "uint256" },
      { name: "pauseCopying", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "riskParams",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "maxLossPerTrade", type: "uint256" },
      { name: "maxAllocationPct", type: "uint256" },
      { name: "pauseCopying", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "setStopLoss",
    stateMutability: "nonpayable",
    inputs: [
      { name: "traderId", type: "uint256" },
      { name: "pct", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "stopLossPct",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "cumulativeLoss",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pauseCopying",
    stateMutability: "nonpayable",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "resumeCopying",
    stateMutability: "nonpayable",
    inputs: [{ name: "traderId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "copyingPaused",
    stateMutability: "view",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "depositWithReferral",
    stateMutability: "nonpayable",
    inputs: [
      { name: "traderId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "referrer", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "referralRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "traderId", type: "uint256", indexed: true },
      { name: "follower", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "traderId", type: "uint256", indexed: true },
      { name: "follower", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CopyExecuted",
    inputs: [
      { name: "traderId", type: "uint256", indexed: true },
      { name: "pool", type: "address", indexed: true },
      { name: "isBid", type: "bool", indexed: false },
      { name: "orderId", type: "uint128", indexed: false },
      { name: "inputToken", type: "address", indexed: false },
      { name: "inputSpent", type: "uint256", indexed: false },
      { name: "outputToken", type: "address", indexed: false },
      { name: "outputReceived", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

// Minimal ERC-20 surface needed to approve CopyVault before depositing.
export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

// Mirrors dreamcopy/contracts/src/ReferralRegistry.sol exactly.
export const referralRegistryAbi = [
  {
    type: "function",
    name: "referredBy",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "referralCount",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "referralEarnings",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimEarnings",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "referrerCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "referrers",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "ReferralRegistered",
    inputs: [
      { name: "referee", type: "address", indexed: true },
      { name: "referrer", type: "address", indexed: true },
      { name: "feeAmount", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;
