// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IDreamDEXPool} from "../../src/interfaces/IDreamDEX.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Test double for a DreamDEX SpotPool implementing the exact
/// interface verified against the real bot-kit ABI (see IDreamDEX.sol). This
/// is a unit-test fixture for CopyVault's accounting logic (balance-delta
/// tracking, revert paths, allowance usage) — it is never deployed anywhere
/// near production and models fills abstractly (price/quantity are not
/// tick/lot validated the way a real pool would). Real integration is
/// exercised separately via a fork test against the live testnet pool (see
/// test/CopyVault.fork.t.sol / docs/LIMITATIONS.md).
contract MockDreamDEXPool is IDreamDEXPool {
    MockERC20 public immutable baseToken;
    MockERC20 public immutable quoteToken;
    bool public immutable baseIsNativeSentinel;
    address public immutable nativeSentinel;

    uint128 public nextOrderId = 1;

    /// @dev Basis-points fraction of the requested quantity actually filled
    /// (10_000 = full fill). Lets tests exercise IOC partial-fill accounting.
    uint256 public fillBps = 10_000;
    bool public rejectNextOrder;

    constructor(address _baseToken, address _quoteToken, address _nativeSentinel, bool _baseIsNative) {
        baseToken = MockERC20(_baseToken);
        quoteToken = MockERC20(_quoteToken);
        nativeSentinel = _nativeSentinel;
        baseIsNativeSentinel = _baseIsNative;
    }

    function setFillBps(uint256 bps) external {
        fillBps = bps;
    }

    function setRejectNextOrder(bool reject) external {
        rejectNextOrder = reject;
    }

    // 1e18-scaled fixed point price, mirroring how the real pool prices
    // quote-per-base for this test double's purposes only.
    function _quoteAmount(uint256 price, uint256 quantity) internal pure returns (uint256) {
        return (price * quantity) / 1e18;
    }

    function placeOrder(
        bool isBid,
        uint64, /* userData */
        uint256 price,
        uint256 quantity,
        uint64, /* expireTimestampNs */
        uint8, /* orderType */
        uint8, /* selfMatchingOption */
        address, /* builder */
        uint96 /* builderFeeBpsTimes1k */
    )
        external
        payable
        returns (bool success, uint128 orderId)
    {
        if (rejectNextOrder) {
            rejectNextOrder = false;
            return (false, 0);
        }

        uint256 filledQuantity = (quantity * fillBps) / 10_000;
        uint256 filledQuote = _quoteAmount(price, filledQuantity);

        if (isBid) {
            quoteToken.transferFrom(msg.sender, address(this), filledQuote);
            if (baseIsNativeSentinel) revert("mock: native payout not modeled");
            baseToken.mint(msg.sender, filledQuantity);
        } else {
            if (baseIsNativeSentinel) revert("mock: native pull not modeled");
            baseToken.transferFrom(msg.sender, address(this), filledQuantity);
            quoteToken.mint(msg.sender, filledQuote);
        }

        orderId = nextOrderId++;
        return (true, orderId);
    }

    function placeOrderFor(address, bool, uint64, uint256, uint256, uint64, uint8, uint8, address, uint96)
        external
        payable
        returns (bool, uint128)
    {
        revert("mock: placeOrderFor not modeled");
    }

    function cancelOrder(uint128) external pure {
        revert("mock: not modeled");
    }

    function reduceOrder(uint128, uint256) external pure {
        revert("mock: not modeled");
    }

    function deposit(address, uint256) external pure {
        revert("mock: not modeled");
    }

    function depositNative() external payable {
        revert("mock: not modeled");
    }

    function withdraw(address, uint256) external pure {
        revert("mock: not modeled");
    }

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
        )
    {
        baseToken_ = baseIsNativeSentinel ? nativeSentinel : address(baseToken);
        quoteToken_ = address(quoteToken);
        makerFeeBpsTimes1k_ = 0;
        takerFeeBpsTimes1k_ = 0;
        tickSize_ = 1;
        minQuantity_ = 1;
        lotSize_ = 1;
    }

    function getBookLevels(bool, uint64) external pure returns (BookLevel[] memory) {
        return new BookLevel[](0);
    }

    function getWithdrawableBalance(address, address) external pure returns (uint256) {
        return 0;
    }

    function getOwnOpenOrders() external pure returns (uint128[] memory) {
        return new uint128[](0);
    }

    function getAutoPullRequirement(address, bool isBid, uint256 price, uint256 quantity, uint96)
        external
        view
        returns (address inputToken, uint256 requiredAmount, uint256 delta)
    {
        if (isBid) {
            inputToken = address(quoteToken);
            requiredAmount = _quoteAmount(price, quantity);
        } else {
            inputToken = baseIsNativeSentinel ? nativeSentinel : address(baseToken);
            requiredAmount = quantity;
        }
        delta = 0;
    }

    function getOrder(uint128) external pure returns (Order memory) {
        revert("mock: not modeled");
    }
}
