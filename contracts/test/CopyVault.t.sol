// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CopyVault} from "../src/CopyVault.sol";
import {TraderRegistry} from "../src/TraderRegistry.sol";
import {ReferralRegistry} from "../src/ReferralRegistry.sol";
import {Trader, TraderNotFound, TraderInactive} from "../src/CopyTypes.sol";
import {DREAMDEX_NATIVE_SENTINEL} from "../src/interfaces/IDreamDEX.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockDreamDEXPool} from "./mocks/MockDreamDEXPool.sol";

contract CopyVaultTest is Test {
    TraderRegistry internal registry;
    CopyVault internal vault;
    ReferralRegistry internal referrals;
    MockERC20 internal usdso; // collateral / quote token
    MockERC20 internal weth; // base token
    MockDreamDEXPool internal pool;
    MockDreamDEXPool internal nativeBasePool;

    address internal owner = makeAddr("owner");
    address internal executor = makeAddr("executor");
    address internal traderWallet = makeAddr("traderWallet");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal traderId;

    function setUp() public {
        registry = new TraderRegistry();
        usdso = new MockERC20("USD Somnia", "USDso");
        weth = new MockERC20("Wrapped ETH", "WETH");

        vault = new CopyVault(address(usdso), address(registry), executor, owner);
        registry.setCopyVault(address(vault)); // test contract is registry's owner by default

        referrals = new ReferralRegistry(address(usdso), address(vault));
        vm.prank(owner);
        vault.setReferralRegistry(address(referrals));

        pool = new MockDreamDEXPool(address(weth), address(usdso), DREAMDEX_NATIVE_SENTINEL, false);
        nativeBasePool = new MockDreamDEXPool(address(0), address(usdso), DREAMDEX_NATIVE_SENTINEL, true);

        vm.startPrank(owner);
        vault.setApprovedPool(address(pool), true);
        vault.setApprovedPool(address(nativeBasePool), true);
        vm.stopPrank();

        vm.prank(traderWallet);
        traderId = registry.registerTrader("alpha-desk");

        vm.prank(alice);
        registry.follow(traderId);
        vm.prank(bob);
        registry.follow(traderId);

        usdso.mint(alice, 10_000e18);
        usdso.mint(bob, 10_000e18);

        vm.prank(alice);
        usdso.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdso.approve(address(vault), type(uint256).max);
    }

    // ── deposit ──────────────────────────────────────────────────────────

    function test_deposit_firstDepositorGetsSharesOneToOne() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(traderId, 1_000e18);

        assertEq(shares, 1_000e18);
        assertEq(vault.sharesOf(traderId, alice), 1_000e18);
        assertEq(vault.totalSharesOf(traderId), 1_000e18);
        assertEq(vault.poolNav(traderId), 1_000e18);
        assertEq(usdso.balanceOf(address(vault)), 1_000e18);
    }

    function test_deposit_secondDepositorGetsProportionalShares() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(bob);
        uint256 bobShares = vault.deposit(traderId, 500e18);

        // NAV was 1_000e18 with 1_000e18 shares outstanding -> 1:1 price still.
        assertEq(bobShares, 500e18);
        assertEq(vault.totalSharesOf(traderId), 1_500e18);
    }

    function test_deposit_revertsIfNotFollowing() public {
        address carol = makeAddr("carol");
        usdso.mint(carol, 100e18);
        vm.prank(carol);
        usdso.approve(address(vault), type(uint256).max);

        vm.prank(carol);
        vm.expectRevert(CopyVault.NotFollowingTrader.selector);
        vault.deposit(traderId, 100e18);
    }

    function test_deposit_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(CopyVault.ZeroAmount.selector);
        vault.deposit(traderId, 0);
    }

    function test_deposit_revertsOnUnknownTrader() public {
        vm.prank(alice);
        vm.expectRevert(TraderNotFound.selector);
        vault.deposit(999, 100e18);
    }

    function test_deposit_revertsWhenTraderInactive() public {
        vm.prank(traderWallet);
        registry.deactivateTrader(traderId);

        vm.prank(alice);
        vm.expectRevert(TraderInactive.selector);
        vault.deposit(traderId, 100e18);
    }

    // ── withdraw ─────────────────────────────────────────────────────────

    function test_withdraw_returnsCollateralAndBurnsShares() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        uint256 balBefore = usdso.balanceOf(alice);

        vm.prank(alice);
        uint256 amount = vault.withdraw(traderId, 400e18);

        assertEq(amount, 400e18);
        assertEq(usdso.balanceOf(alice), balBefore + 400e18);
        assertEq(vault.sharesOf(traderId, alice), 600e18);
        assertEq(vault.totalSharesOf(traderId), 600e18);
    }

    function test_withdraw_revertsOnInsufficientShares() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(alice);
        vm.expectRevert(CopyVault.InsufficientShares.selector);
        vault.withdraw(traderId, 1_001e18);
    }

    function test_withdraw_revertsWhenFundsDeployed() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        // Deploy the whole pool into an open position (full-fill buy).
        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 1_000e18, uint64(block.timestamp + 1), 2, 0);

        assertEq(vault.tokenBalance(traderId, address(usdso)), 0);

        vm.prank(alice);
        vm.expectRevert(CopyVault.InsufficientIdleBalance.selector);
        vault.withdraw(traderId, 1_000e18);
    }

    // ── executeCopy: access control ─────────────────────────────────────

    function test_executeCopy_revertsWhenNotExecutor() public {
        vm.prank(alice);
        vm.expectRevert(CopyVault.NotExecutor.selector);
        vault.executeCopy(traderId, address(pool), true, 1e18, 1e18, uint64(block.timestamp + 1), 2, 0);
    }

    function test_executeCopy_revertsWhenPoolNotApproved() public {
        MockDreamDEXPool rogue = new MockDreamDEXPool(address(weth), address(usdso), DREAMDEX_NATIVE_SENTINEL, false);

        vm.prank(executor);
        vm.expectRevert(CopyVault.PoolNotApproved.selector);
        vault.executeCopy(traderId, address(rogue), true, 1e18, 1e18, uint64(block.timestamp + 1), 2, 0);
    }

    function test_executeCopy_revertsOnNativeSettlement() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        // Selling the native-sentinel base side must be rejected, not silently mishandled.
        vm.prank(executor);
        vm.expectRevert(CopyVault.NativeSettlementNotSupported.selector);
        vault.executeCopy(traderId, address(nativeBasePool), false, 1e18, 10e18, uint64(block.timestamp + 1), 2, 0);
    }

    function test_executeCopy_revertsOnInsufficientPoolBalance() public {
        vm.prank(alice);
        vault.deposit(traderId, 100e18);

        vm.prank(executor);
        vm.expectRevert(CopyVault.InsufficientPoolBalance.selector);
        // Requires 1_000e18 USDso (price 1e18 * qty 1_000e18 / 1e18) but pool only has 100e18.
        vault.executeCopy(traderId, address(pool), true, 1e18, 1_000e18, uint64(block.timestamp + 1), 2, 0);
    }

    function test_executeCopy_revertsWhenOrderRejected() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        pool.setRejectNextOrder(true);

        vm.prank(executor);
        vm.expectRevert(CopyVault.OrderRejected.selector);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, uint64(block.timestamp + 1), 2, 0);
    }

    // ── executeCopy: real accounting ────────────────────────────────────

    function test_executeCopy_fullBuyMovesCollateralIntoBaseAndTracksCostBasis() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(executor);
        uint128 orderId =
            vault.executeCopy(traderId, address(pool), true, 1e18, 1_000e18, uint64(block.timestamp + 1), 2, 0);

        assertEq(orderId, 1);
        assertEq(vault.tokenBalance(traderId, address(usdso)), 0);
        assertEq(vault.tokenBalance(traderId, address(weth)), 1_000e18);
        assertEq(vault.deployedCostBasis(traderId), 1_000e18);
        // NAV unchanged (idle 0 + cost basis 1_000e18) — no P&L yet, just a swap.
        assertEq(vault.poolNav(traderId), 1_000e18);
    }

    function test_executeCopy_partialFillOnlySpendsAndCreditsTheFilledPortion() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        pool.setFillBps(5_000); // IOC only fills half

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 1_000e18, uint64(block.timestamp + 1), 2, 0);

        // Only half filled: 500e18 USDso spent, 500e18 WETH received.
        assertEq(vault.tokenBalance(traderId, address(usdso)), 500e18);
        assertEq(vault.tokenBalance(traderId, address(weth)), 500e18);
        assertEq(vault.deployedCostBasis(traderId), 500e18);
    }

    function test_executeCopy_roundTripWithProfitIncreasesWithdrawableNav() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        // Buy 1_000 WETH-equivalent at price 1.0.
        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 1_000e18, uint64(block.timestamp + 1), 2, 0);

        // Sell it all back at price 1.2 -> 200e18 realized profit.
        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), false, 1.2e18, 1_000e18, uint64(block.timestamp + 1), 2, 0);

        assertEq(vault.tokenBalance(traderId, address(weth)), 0);
        assertEq(vault.deployedCostBasis(traderId), 0);
        assertEq(vault.tokenBalance(traderId, address(usdso)), 1_200e18);
        assertEq(vault.poolNav(traderId), 1_200e18);

        // Alice, the sole depositor, can now withdraw the full profit.
        uint256 aliceShares = vault.sharesOf(traderId, alice);
        vm.prank(alice);
        uint256 amount = vault.withdraw(traderId, aliceShares);
        assertEq(amount, 1_200e18);
    }

    function test_executeCopy_profitSharedProportionallyAcrossFollowers() public {
        vm.prank(alice);
        vault.deposit(traderId, 750e18); // 75%
        vm.prank(bob);
        vault.deposit(traderId, 250e18); // 25%

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 1_000e18, uint64(block.timestamp + 1), 2, 0);
        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), false, 1.2e18, 1_000e18, uint64(block.timestamp + 1), 2, 0);

        // Pool NAV is now 1_200e18 total (1_000e18 principal + 200e18 profit).
        uint256 aliceShares = vault.sharesOf(traderId, alice);
        uint256 bobShares = vault.sharesOf(traderId, bob);
        vm.prank(alice);
        uint256 aliceOut = vault.withdraw(traderId, aliceShares);
        vm.prank(bob);
        uint256 bobOut = vault.withdraw(traderId, bobShares);

        assertEq(aliceOut, 900e18); // 75% of 1_200e18
        assertEq(bobOut, 300e18); // 25% of 1_200e18
    }

    // ── admin ────────────────────────────────────────────────────────────

    function test_setExecutor_onlyOwner() public {
        address newExecutor = makeAddr("newExecutor");

        vm.prank(alice);
        vm.expectRevert();
        vault.setExecutor(newExecutor);

        vm.prank(owner);
        vault.setExecutor(newExecutor);
        assertEq(vault.executor(), newExecutor);
    }

    function test_setApprovedPool_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setApprovedPool(address(pool), false);

        vm.prank(owner);
        vault.setApprovedPool(address(pool), false);
        assertFalse(vault.isApprovedPool(address(pool)));
    }

    function test_constructor_revertsOnZeroAddresses() public {
        vm.expectRevert(CopyVault.ZeroAddress.selector);
        new CopyVault(address(0), address(registry), executor, owner);
    }

    // ── setAllocations / getUserAllocations ────────────────────────────

    function test_setAllocations_storesAndSumsUpTo100() public {
        address trader2Wallet = makeAddr("trader2Wallet");
        vm.prank(trader2Wallet);
        uint256 traderId2 = registry.registerTrader("beta-desk");
        vm.prank(alice);
        registry.follow(traderId2);

        uint256[] memory ids = new uint256[](2);
        ids[0] = traderId;
        ids[1] = traderId2;
        uint256[] memory pcts = new uint256[](2);
        pcts[0] = 60;
        pcts[1] = 40;

        vm.prank(alice);
        vault.setAllocations(ids, pcts);

        assertEq(vault.allocationPctOf(alice, traderId), 60);
        assertEq(vault.allocationPctOf(alice, traderId2), 40);

        (uint256[] memory outIds, uint256[] memory outPcts) = vault.getUserAllocations(alice);
        assertEq(outIds.length, 2);
        assertEq(outIds[0], traderId);
        assertEq(outIds[1], traderId2);
        assertEq(outPcts[0], 60);
        assertEq(outPcts[1], 40);
    }

    function test_setAllocations_revertsWhenSumExceeds100() public {
        address trader2Wallet = makeAddr("trader2Wallet");
        vm.prank(trader2Wallet);
        uint256 traderId2 = registry.registerTrader("beta-desk");
        vm.prank(alice);
        registry.follow(traderId2);

        uint256[] memory ids = new uint256[](2);
        ids[0] = traderId;
        ids[1] = traderId2;
        uint256[] memory pcts = new uint256[](2);
        pcts[0] = 70;
        pcts[1] = 40;

        vm.prank(alice);
        vm.expectRevert(CopyVault.AllocationExceeds100.selector);
        vault.setAllocations(ids, pcts);
    }

    function test_setAllocations_revertsIfNotFollowingOneOfThem() public {
        address trader2Wallet = makeAddr("trader2Wallet");
        vm.prank(trader2Wallet);
        uint256 traderId2 = registry.registerTrader("beta-desk");
        // alice deliberately does NOT follow traderId2 here.

        uint256[] memory ids = new uint256[](2);
        ids[0] = traderId;
        ids[1] = traderId2;
        uint256[] memory pcts = new uint256[](2);
        pcts[0] = 50;
        pcts[1] = 50;

        vm.prank(alice);
        vm.expectRevert(CopyVault.NotFollowingTrader.selector);
        vault.setAllocations(ids, pcts);
    }

    function test_setAllocations_revertsOnArrayLengthMismatch() public {
        uint256[] memory ids = new uint256[](2);
        ids[0] = traderId;
        ids[1] = traderId;
        uint256[] memory pcts = new uint256[](1);
        pcts[0] = 50;

        vm.prank(alice);
        vm.expectRevert(CopyVault.ArrayLengthMismatch.selector);
        vault.setAllocations(ids, pcts);
    }

    function test_getUserAllocations_onlyReturnsFollowedTradersDefaultingToZeroPct() public view {
        // alice follows traderId (from setUp) but never called setAllocations.
        (uint256[] memory ids, uint256[] memory pcts) = vault.getUserAllocations(alice);
        assertEq(ids.length, 1);
        assertEq(ids[0], traderId);
        assertEq(pcts[0], 0);
    }

    // ── setRiskParams / risk enforcement ────────────────────────────────

    function test_setRiskParams_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setRiskParams(traderId, 0, 50, false);

        vm.prank(owner);
        vault.setRiskParams(traderId, 0, 50, false);
        (uint256 maxLoss, uint256 maxAllocPct, bool paused) = vault.riskParams(traderId);
        assertEq(maxLoss, 0);
        assertEq(maxAllocPct, 50);
        assertFalse(paused);
    }

    function test_setRiskParams_revertsOnAllocationPctOver100() public {
        vm.prank(owner);
        vm.expectRevert(CopyVault.InvalidMaxAllocationPct.selector);
        vault.setRiskParams(traderId, 0, 101, false);
    }

    function test_executeCopy_pauseCopying_blocksTrade() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(owner);
        vault.setRiskParams(traderId, 0, 0, true);

        vm.prank(executor);
        vm.expectRevert(CopyVault.CopyingPausedByRiskParams.selector);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0);
    }

    function test_executeCopy_pauseCopyingFalse_doesNotBlockTrade() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(owner);
        vault.setRiskParams(traderId, 0, 0, false);

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0);
        assertEq(vault.deployedCostBasis(traderId), 100e18);
    }

    function test_executeCopy_maxAllocationPct_capsQuantityDownOnBid() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        // 20% of a 1_000e18 NAV pool = 200e18 max spend per BID.
        vm.prank(owner);
        vault.setRiskParams(traderId, 0, 20, false);

        // Requesting 500e18 (price 1:1 -> would need 500e18 collateral) —
        // well over the 200e18 cap.
        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 500e18, 0, 0, 0);

        // Scaled down to exactly the cap, not the requested 500e18.
        assertEq(vault.deployedCostBasis(traderId), 200e18);
        assertEq(vault.tokenBalance(traderId, address(usdso)), 1_000e18 - 200e18);
        assertEq(weth.balanceOf(address(vault)), 200e18);
    }

    function test_executeCopy_maxAllocationPct_doesNotCapWhenUnderCap() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(owner);
        vault.setRiskParams(traderId, 0, 50, false); // cap = 500e18

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0); // well under cap

        assertEq(vault.deployedCostBasis(traderId), 100e18); // not scaled down
    }

    function test_executeCopy_maxAllocationPct_zeroMeansDisabled() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(owner);
        vault.setRiskParams(traderId, 0, 0, false); // 0 = disabled

        vm.prank(executor);
        // Would exceed any small cap, but 0 means no cap is applied at all.
        vault.executeCopy(traderId, address(pool), true, 1e18, 900e18, 0, 0, 0);
        assertEq(vault.deployedCostBasis(traderId), 900e18);
    }

    function test_executeCopy_maxLossPerTrade_revertsWhenRealizedLossExceedsLimit() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0); // buy 100e18 base @ 1:1

        vm.prank(owner);
        vault.setRiskParams(traderId, 5e18, 0, false); // max 5e18 loss per trade

        // Sell all 100e18 base back at 0.9:1 -> proceeds 90e18, basis
        // released 100e18 -> realized loss 10e18, over the 5e18 limit.
        vm.prank(executor);
        vm.expectRevert(CopyVault.MaxLossExceeded.selector);
        vault.executeCopy(traderId, address(pool), false, 0.9e18, 100e18, 0, 0, 0);

        // Reverted atomically — the sell must not have partially applied.
        assertEq(vault.deployedCostBasis(traderId), 100e18);
        assertEq(weth.balanceOf(address(vault)), 100e18);
    }

    function test_executeCopy_maxLossPerTrade_allowsLossUnderLimit() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0);

        vm.prank(owner);
        vault.setRiskParams(traderId, 5e18, 0, false);

        // Sell at 0.97:1 -> proceeds 97e18, loss 3e18, under the 5e18 limit.
        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), false, 0.97e18, 100e18, 0, 0, 0);

        assertEq(vault.deployedCostBasis(traderId), 0);
        assertEq(vault.tokenBalance(traderId, address(usdso)), 1_000e18 - 100e18 + 97e18);
    }

    function test_executeCopy_maxLossPerTrade_doesNotApplyToBids() public {
        // A BID has no realized loss to check — even a very tight loss
        // limit must never block opening a position.
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(owner);
        vault.setRiskParams(traderId, 1, 0, false); // 1 wei max loss

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0);
        assertEq(vault.deployedCostBasis(traderId), 100e18);
    }

    // ── setStopLoss / stop-loss enforcement ─────────────────────────────

    function test_setStopLoss_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setStopLoss(traderId, 10);

        vm.prank(owner);
        vault.setStopLoss(traderId, 10);
        assertEq(vault.stopLossPct(traderId), 10);
    }

    function test_setStopLoss_revertsOnPctOver100() public {
        vm.prank(owner);
        vm.expectRevert(CopyVault.InvalidStopLossPct.selector);
        vault.setStopLoss(traderId, 101);
    }

    function test_executeCopy_stopLoss_triggersAtThreshold() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0); // buy 100e18 @ 1:1

        vm.prank(owner);
        vault.setStopLoss(traderId, 5); // 5% of pool NAV

        // Sell all 100e18 base @ 0.5:1 -> proceeds 50e18, loss 50e18.
        // Post-trade NAV = 900e18 idle + 50e18 proceeds = 950e18.
        // Threshold = 5% * 950e18 = 47.5e18 < 50e18 loss -> triggers.
        vm.expectEmit(true, false, false, true);
        emit CopyVault.StopLossTriggered(traderId, 50e18);

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), false, 0.5e18, 100e18, 0, 0, 0);

        assertEq(vault.cumulativeLoss(traderId), 50e18);
        (,, bool paused) = vault.riskParams(traderId);
        assertTrue(paused);

        // The auto-triggered pause reuses Feature 2's enforced circuit
        // breaker — the next trade must now actually revert.
        vm.prank(executor);
        vm.expectRevert(CopyVault.CopyingPausedByRiskParams.selector);
        vault.executeCopy(traderId, address(pool), true, 1e18, 1e18, 0, 0, 0);
    }

    function test_executeCopy_stopLoss_disabledWhenPctZero() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0);

        // stopLossPct left at its default (0) = disabled.
        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), false, 0.5e18, 100e18, 0, 0, 0); // 50e18 loss

        assertEq(vault.cumulativeLoss(traderId), 50e18); // still tracked...
        (,, bool paused) = vault.riskParams(traderId);
        assertFalse(paused); // ...but never triggers the auto-pause
    }

    function test_executeCopy_stopLoss_cumulativeAcrossMultipleTrades() public {
        vm.prank(alice);
        vault.deposit(traderId, 10_000e18);

        vm.prank(owner);
        vault.setStopLoss(traderId, 90); // high threshold so we can observe accumulation without tripping it

        vm.startPrank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0); // buy 100e18
        vault.executeCopy(traderId, address(pool), false, 0.9e18, 50e18, 0, 0, 0); // sell half @ loss
        vm.stopPrank();

        uint256 lossAfterFirstSell = vault.cumulativeLoss(traderId);
        assertGt(lossAfterFirstSell, 0);

        vm.startPrank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 50e18, 0, 0, 0); // buy back
        vault.executeCopy(traderId, address(pool), false, 0.9e18, 50e18, 0, 0, 0); // sell @ loss again
        vm.stopPrank();

        // Losses accumulate, never reset between trades.
        assertGt(vault.cumulativeLoss(traderId), lossAfterFirstSell);
    }

    // ── Feature 7: recordTradeResult integration ────────────────────────

    function test_executeCopy_recordsWinOnProfitableSell() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.startPrank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0); // buy @ 1:1
        vault.executeCopy(traderId, address(pool), false, 1.1e18, 100e18, 0, 0, 0); // sell @ profit
        vm.stopPrank();

        assertEq(registry.getWinRate(traderId), 100);
        (uint256 totalTrades, uint256 winningTrades,) = registry.performance(traderId);
        assertEq(totalTrades, 1);
        assertEq(winningTrades, 1);
    }

    function test_executeCopy_recordsLossOnLosingSell() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.startPrank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0);
        vault.executeCopy(traderId, address(pool), false, 0.9e18, 100e18, 0, 0, 0); // sell @ loss
        vm.stopPrank();

        assertEq(registry.getWinRate(traderId), 0);
        (uint256 totalTrades, uint256 winningTrades,) = registry.performance(traderId);
        assertEq(totalTrades, 1);
        assertEq(winningTrades, 0);
    }

    function test_executeCopy_doesNotRecordResultOnBuy() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0);

        (uint256 totalTrades,,) = registry.performance(traderId);
        assertEq(totalTrades, 0); // a BUY alone records nothing
    }

    // ── Feature 8: personal (advisory) pauseCopying / resumeCopying ─────

    function test_pauseCopying_requiresFollowing() public {
        address carol = makeAddr("carol");
        vm.prank(carol);
        vm.expectRevert(CopyVault.NotFollowingTrader.selector);
        vault.pauseCopying(traderId);
    }

    function test_pauseCopying_resumeCopying_toggleCorrectly() public {
        vm.prank(alice);
        vault.pauseCopying(traderId);
        assertTrue(vault.copyingPaused(alice, traderId));

        vm.prank(alice);
        vault.resumeCopying(traderId);
        assertFalse(vault.copyingPaused(alice, traderId));
    }

    function test_pauseCopying_isAdvisoryOnly_doesNotBlockExecuteCopy() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        // Alice personally "pauses" — but this is pool-wide pooled money;
        // her personal preference must NOT block the pool's shared trade.
        vm.prank(alice);
        vault.pauseCopying(traderId);
        assertTrue(vault.copyingPaused(alice, traderId));

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0);
        assertEq(vault.deployedCostBasis(traderId), 100e18); // trade went through
    }

    // ── Feature 9: depositWithReferral ──────────────────────────────────

    function test_depositWithReferral_takesFeeAndCreditsReferrer() public {
        address referrer = makeAddr("referrer");

        vm.prank(alice);
        uint256 shares = vault.depositWithReferral(traderId, 1_000e18, referrer);

        uint256 expectedFee = (1_000e18 * vault.REFERRAL_FEE_BPS()) / 10_000; // 0.5% = 5e18
        assertEq(expectedFee, 5e18);

        // Shares minted against the NET amount, not the full deposit.
        assertEq(shares, 1_000e18 - expectedFee);
        assertEq(vault.tokenBalance(traderId, address(usdso)), 1_000e18 - expectedFee);

        assertEq(referrals.referredBy(alice), referrer);
        assertEq(referrals.referralEarnings(referrer), expectedFee);
        assertEq(usdso.balanceOf(address(referrals)), expectedFee);
    }

    function test_depositWithReferral_onlyFirstDepositTriggersReferral() public {
        address referrer = makeAddr("referrer");
        address referrer2 = makeAddr("referrer2");

        vm.prank(alice);
        vault.depositWithReferral(traderId, 1_000e18, referrer);

        // A second deposit, even with a different referrer, must not charge
        // another fee or overwrite the referral relationship.
        vm.prank(alice);
        uint256 shares2 = vault.depositWithReferral(traderId, 1_000e18, referrer2);

        assertEq(shares2, 1_000e18); // full amount, no fee this time
        assertEq(referrals.referredBy(alice), referrer); // unchanged
        assertEq(referrals.referralEarnings(referrer2), 0);
    }

    function test_depositWithReferral_plainDepositAlsoCountsAsFirstDeposit() public {
        address referrer = makeAddr("referrer");

        vm.prank(alice);
        vault.deposit(traderId, 100e18); // plain deposit first

        vm.prank(alice);
        uint256 shares = vault.depositWithReferral(traderId, 1_000e18, referrer);

        // hasEverDeposited was already true from the plain deposit -> no fee.
        assertEq(shares, 1_000e18);
        assertEq(referrals.referralEarnings(referrer), 0);
    }

    function test_depositWithReferral_revertsOnSelfReferral() public {
        vm.prank(alice);
        vm.expectRevert(CopyVault.SelfReferral.selector);
        vault.depositWithReferral(traderId, 1_000e18, alice);
    }

    function test_depositWithReferral_noReferrerBehavesLikePlainDeposit() public {
        vm.prank(alice);
        uint256 shares = vault.depositWithReferral(traderId, 1_000e18, address(0));
        assertEq(shares, 1_000e18); // no fee taken
    }

    function test_setReferralRegistry_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setReferralRegistry(address(referrals));

        vm.prank(owner);
        vault.setReferralRegistry(address(referrals));
        assertEq(vault.referralRegistry(), address(referrals));
    }

    // ── Feature 16: recordPnL integration ───────────────────────────────

    function test_executeCopy_recordsPnLOnBid_zeroDeltaExactVolume() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.prank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0); // buy 100e18 @ 1:1 -> spends 100e18

        (int256 realizedPnL, uint256 totalVolume,) = registry.traderPnL(traderId);
        assertEq(realizedPnL, 0); // no realized P&L on a bid
        assertEq(totalVolume, 100e18); // exact collateral spent, not estimated
    }

    function test_executeCopy_recordsPnLOnProfitableSell() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.startPrank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0); // buy 100e18 @ 1:1, basis=100e18
        vault.executeCopy(traderId, address(pool), false, 1.1e18, 100e18, 0, 0, 0); // sell @ 1.1:1 -> proceeds 110e18
        vm.stopPrank();

        (int256 realizedPnL, uint256 totalVolume, uint256 bestTrade) = registry.traderPnL(traderId);
        assertEq(realizedPnL, 10e18); // 110 proceeds - 100 basis
        assertEq(totalVolume, 100e18 + 110e18); // bid volume + sell volume
        assertEq(bestTrade, 10e18);
    }

    function test_executeCopy_recordsPnLOnLosingSell() public {
        vm.prank(alice);
        vault.deposit(traderId, 1_000e18);

        vm.startPrank(executor);
        vault.executeCopy(traderId, address(pool), true, 1e18, 100e18, 0, 0, 0);
        vault.executeCopy(traderId, address(pool), false, 0.9e18, 100e18, 0, 0, 0); // sell @ loss -> proceeds 90e18
        vm.stopPrank();

        (int256 realizedPnL,,) = registry.traderPnL(traderId);
        assertEq(realizedPnL, -10e18); // negative, tracked correctly
    }

    function test_executeCopy_recordPnL_onlyCopyVaultCanCallDirectly() public {
        // Sanity check the underlying access control CopyVault itself
        // relies on (already covered directly in TraderRegistry.t.sol, but
        // confirmed here too since CopyVault's own executeCopy path
        // depends on being the wired copyVault).
        vm.prank(alice);
        vm.expectRevert(TraderRegistry.OnlyCopyVault.selector);
        registry.recordPnL(traderId, 1e18, 1e18);
    }
}
