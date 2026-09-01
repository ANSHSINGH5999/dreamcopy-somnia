import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { config } from "./config.js";

// ABI fragments mirror dreamcopy/contracts/src/TraderRegistry.sol and
// CopyVault.sol exactly — every entry here corresponds to a real, tested
// Solidity function/event (see those files), not a guess. Same convention as
// dreamcopy/web/src/lib/contracts.ts.

export const traderRegistryAbi = [
  "function traderCount() view returns (uint256)",
  "function getTrader(uint256 traderId) view returns (tuple(address wallet, string label, bool active, uint256 followerCount))",
  "function traderIdByWallet(address wallet) view returns (uint256)",
  // NOTE: not deployed yet as of this commit — being added alongside
  // Feature 16's PnL struct in the same TraderRegistry redeploy (see
  // docs/ARCHITECTURE.md's redeploy log). Calls to it will revert until
  // then; notifications.ts's caller (executor.ts) already treats that
  // revert as "no followers" rather than crashing, so this is safe to
  // reference now and it starts working the moment that redeploy lands.
  "function getFollowers(uint256 traderId) view returns (address[])",
  "event TraderRegistered(uint256 indexed traderId, address indexed wallet, string label)",
  "event TraderDeactivated(uint256 indexed traderId)",
  "event TraderReactivated(uint256 indexed traderId)",
];

export const copyVaultAbi = [
  "function executeCopy(uint256 traderId, address pool, bool isBid, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint96 builderFeeBpsTimes1k) returns (uint128 orderId)",
  "function isApprovedPool(address pool) view returns (bool)",
  "function collateralToken() view returns (address)",
  "function poolNav(uint256 traderId) view returns (uint256)",
  "event CopyExecuted(uint256 indexed traderId, address indexed pool, bool isBid, uint128 orderId, address inputToken, uint256 inputSpent, address outputToken, uint256 outputReceived)",
  "event StopLossTriggered(uint256 indexed traderId, uint256 cumulativeLoss)",
];

// Minimal DreamDEX pool surface the indexer needs for proportional sizing.
// Mirrors contracts/src/interfaces/IDreamDEX.sol's IDreamDEXPool exactly —
// this is the ONLY on-chain source of a trader's own capital: TraderRegistry
// has no such field (its Trader struct is {wallet, label, active,
// followerCount} — see contracts/src/TraderRegistry.sol). Do not add a fake
// "capital" read against TraderRegistry; there is nothing there to read.
export const dreamDexPoolAbi = ["function getWithdrawableBalance(address owner, address token) view returns (uint256)"];

// Mirrors contracts/src/ReferralRegistry.sol exactly.
export const referralRegistryAbi = [
  "event ReferralRegistered(address indexed referee, address indexed referrer, uint256 feeAmount)",
];

export const provider = new JsonRpcProvider(config.rpcUrl);

/// The indexer's hot wallet — also CopyVault's `executor` (see the deploy in
/// docs/ARCHITECTURE.md). Can trigger trades, never withdraw — see
/// docs/LIMITATIONS.md #5 for the trust model this relies on.
export const executorWallet = new Wallet(config.deployerPrivateKey, provider);

/// Read-only instance for polling the trader list.
export const traderRegistry = new Contract(config.traderRegistryAddress, traderRegistryAbi, provider);

/// Signer-connected instance — the only one that can call executeCopy.
export const copyVault = new Contract(config.copyVaultAddress, copyVaultAbi, executorWallet);

/// Read-only — used only to watch for ReferralRegistered events (see
/// notifications.ts's referral watcher).
export const referralRegistry = new Contract(config.referralRegistryAddress, referralRegistryAbi, provider);
