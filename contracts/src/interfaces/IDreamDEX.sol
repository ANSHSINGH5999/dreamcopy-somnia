// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface for a DreamDEX SpotPool contract.
/// @dev Mirrors SPOT_POOL_ABI verified from the official reference client at
/// https://github.com/somnia-chain/dreamdex-bot-kit packages/core/src/contract.ts
/// (post-June-2026 upgrade surface). `placeTakerOrderWithoutVault` was removed
/// in that upgrade — `placeOrder` is now the single payable entry point and
/// auto-pulls funds from the caller (native via msg.value, or ERC-20 via an
/// allowance the caller must have granted beforehand — see
/// `getAutoPullRequirement`).
///
/// Pool contract addresses are NEVER hard-coded against this interface — every
/// caller in this repo fetches them at runtime from `GET /v0/markets` (see
/// docs/ARCHITECTURE.md and indexer/src/detector.ts) and only trades against
/// addresses an operator has explicitly allow-listed on-chain
/// (see CopyVault.setApprovedPool).
interface IDreamDEXPool {
    /// @notice Place an order on this pool. Payable: if the auto-pulled input
    /// token for this order is the native-token sentinel (see
    /// `DREAMDEX_NATIVE_SENTINEL`), the exact required amount must be sent as
    /// msg.value; otherwise the pool pulls ERC-20 input via `transferFrom` and
    /// the caller must have approved this pool for at least `requiredAmount`
    /// (see `getAutoPullRequirement`).
    /// @return success False means the order was rejected — the transaction
    /// still mines (no funds move), so the caller MUST check this and revert,
    /// not just check the OrderPlaced event.
    function placeOrder(
        bool isBid,
        uint64 userData,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k
    ) external payable returns (bool success, uint128 orderId);

    /// @notice Split-key / operator surface: place an order on behalf of
    /// `owner` (who must be in manual vault mode with deposited funds and must
    /// have authorized the caller as an operator for this selector via the
    /// OperatorPermissionsRegistry). Not used by CopyVault v1 — see
    /// docs/LIMITATIONS.md for why the direct-funding path was chosen instead.
    function placeOrderFor(
        address owner,
        bool isBid,
        uint64 userData,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k
    ) external payable returns (bool success, uint128 orderId);

    function cancelOrder(uint128 orderId) external;

    function reduceOrder(uint128 orderId, uint256 newQuantityRemaining) external;

    function deposit(address token, uint256 amount) external;

    function depositNative() external payable;

    function withdraw(address token, uint256 amount) external;

    /// @dev Return order MATTERS: makerFee precedes takerFee, and
    /// tick -> minQuantity -> lot, per the verified ABI.
    function getPoolParams()
        external
        view
        returns (
            address baseToken_,
            address quoteToken_,
            uint256 makerFeeBpsTimes1k_,
            uint256 takerFeeBpsTimes1k_,
            uint256 tickSize_,
            uint256 minQuantity_,
            uint256 lotSize_
        );

    struct BookLevel {
        uint256 price;
        uint256 quantity;
    }

    function getBookLevels(bool isBid, uint64 numLevels) external view returns (BookLevel[] memory);

    function getWithdrawableBalance(address owner, address token) external view returns (uint256);

    function getOwnOpenOrders() external view returns (uint128[] memory);

    /// @notice Tells the caller exactly what `placeOrder` will pull for the
    /// given order parameters: which token (possibly the native sentinel) and
    /// how much. This is the authoritative, always-current source for funding
    /// an order — CopyVault calls this atomically inside the same transaction
    /// as `placeOrder`, never from a stale off-chain read.
    function getAutoPullRequirement(
        address owner,
        bool isBid,
        uint256 price,
        uint256 quantity,
        uint96 builderFeeBpsTimes1k
    ) external view returns (address inputToken, uint256 requiredAmount, uint256 delta);

    struct Order {
        uint128 orderId;
        bool isBid;
        address owner;
        uint64 userData;
        uint256 price;
        uint256 fullQuantity;
        uint256 quantityRemaining;
        uint64 expireTimestampNs;
    }

    function getOrder(uint128 orderId) external view returns (Order memory);
}

// Sentinel address `getAutoPullRequirement` returns as `inputToken` when an
// order's funding side is the chain's native token rather than an ERC-20
// (e.g. the SOMI side of the SOMI:USDso pool on Somnia — SOMI has no ERC-20
// contract, so this sentinel stands in for it). Verified from
// dreamdex-bot-kit packages/core/src/config/tokens.ts (`NATIVE_SENTINEL`).
address constant DREAMDEX_NATIVE_SENTINEL = 0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00;

/// @notice `orderType` values for `placeOrder`, verified from
/// dreamdex-bot-kit packages/core/src/gotchas.ts (`ORDER_TYPE`).
library DreamDEXOrderType {
    uint8 constant NORMAL = 0; // GTC — rests on the book if it doesn't fully fill.
    uint8 constant FILL_OR_KILL = 1; // Fully fill immediately or revert.
    uint8 constant IMMEDIATE_OR_CANCEL = 2; // Fill what you can now, cancel the rest. The taker default.
    uint8 constant POST_ONLY = 3; // Maker-only: rejected if any part would fill immediately.
}

/// @notice `selfMatchingOption` values for `placeOrder`, verified from
/// dreamdex-bot-kit packages/core/src/gotchas.ts (`SELF_MATCH`).
library DreamDEXSelfMatch {
    uint8 constant CANCEL_TAKER = 0; // Cancel the incoming (taker) order if it would hit your own resting order.
    uint8 constant CANCEL_MAKER = 1; // Cancel your resting (maker) order and keep matching.
}
