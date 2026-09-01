// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TraderRegistry} from "../src/TraderRegistry.sol";
import {Trader, TraderNotFound, TraderInactive} from "../src/CopyTypes.sol";

contract TraderRegistryTest is Test {
    TraderRegistry internal registry;

    address internal trader = makeAddr("trader");
    address internal follower = makeAddr("follower");
    address internal other = makeAddr("other");

    function setUp() public {
        registry = new TraderRegistry();
    }

    // ── registerTrader ──────────────────────────────────────────────────

    function test_registerTrader_assignsSequentialIdAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit TraderRegistry.TraderRegistered(1, trader, "alpha-desk");

        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");

        assertEq(id, 1);
        assertEq(registry.traderCount(), 1);
        assertEq(registry.traderIdByWallet(trader), 1);

        Trader memory t = registry.getTrader(1);
        assertEq(t.wallet, trader);
        assertEq(t.label, "alpha-desk");
        assertTrue(t.active);
        assertEq(t.followerCount, 0);
    }

    function test_registerTrader_revertsOnDuplicate() public {
        vm.startPrank(trader);
        registry.registerTrader("alpha-desk");
        vm.expectRevert(TraderRegistry.TraderAlreadyRegistered.selector);
        registry.registerTrader("alpha-desk-2");
        vm.stopPrank();
    }

    function test_registerTrader_revertsOnEmptyLabel() public {
        vm.prank(trader);
        vm.expectRevert(TraderRegistry.EmptyLabel.selector);
        registry.registerTrader("");
    }

    // ── follow / unfollow ───────────────────────────────────────────────

    function test_follow_incrementsFollowerCountAndEmits() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");

        vm.expectEmit(true, true, false, false);
        emit TraderRegistry.Followed(id, follower);

        vm.prank(follower);
        registry.follow(id);

        assertTrue(registry.isFollowing(id, follower));
        assertEq(registry.getTrader(id).followerCount, 1);
    }

    function test_follow_revertsOnUnknownTrader() public {
        vm.prank(follower);
        vm.expectRevert(TraderNotFound.selector);
        registry.follow(999);
    }

    function test_follow_revertsWhenTraderInactive() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");
        vm.prank(trader);
        registry.deactivateTrader(id);

        vm.prank(follower);
        vm.expectRevert(TraderInactive.selector);
        registry.follow(id);
    }

    function test_follow_revertsOnDoubleFollow() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");

        vm.startPrank(follower);
        registry.follow(id);
        vm.expectRevert(TraderRegistry.AlreadyFollowing.selector);
        registry.follow(id);
        vm.stopPrank();
    }

    function test_unfollow_decrementsFollowerCountAndEmits() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");
        vm.prank(follower);
        registry.follow(id);

        vm.expectEmit(true, true, false, false);
        emit TraderRegistry.Unfollowed(id, follower);

        vm.prank(follower);
        registry.unfollow(id);

        assertFalse(registry.isFollowing(id, follower));
        assertEq(registry.getTrader(id).followerCount, 0);
    }

    function test_unfollow_revertsWhenNotFollowing() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");

        vm.prank(follower);
        vm.expectRevert(TraderRegistry.NotFollowing.selector);
        registry.unfollow(id);
    }

    // ── followMultiple ──────────────────────────────────────────────────

    function test_followMultiple_followsEachAndPreservesRealMsgSender() public {
        vm.prank(trader);
        uint256 id1 = registry.registerTrader("alpha-desk");
        address trader2 = makeAddr("trader2");
        vm.prank(trader2);
        uint256 id2 = registry.registerTrader("beta-desk");

        uint256[] memory ids = new uint256[](2);
        ids[0] = id1;
        ids[1] = id2;

        vm.prank(follower);
        registry.followMultiple(ids);

        // The real caller (follower) is recorded, not the contract itself —
        // this is the exact bug that motivated implementing followMultiple
        // here on TraderRegistry instead of routing it through CopyVault.
        assertTrue(registry.isFollowing(id1, follower));
        assertTrue(registry.isFollowing(id2, follower));
        assertEq(registry.getTrader(id1).followerCount, 1);
        assertEq(registry.getTrader(id2).followerCount, 1);
    }

    function test_followMultiple_revertsOnFirstBadEntryLikeALoopWould() public {
        vm.prank(trader);
        uint256 id1 = registry.registerTrader("alpha-desk");

        uint256[] memory ids = new uint256[](2);
        ids[0] = id1;
        ids[1] = 999; // unknown trader

        vm.prank(follower);
        vm.expectRevert(TraderNotFound.selector);
        registry.followMultiple(ids);

        // Whole tx reverted — the first entry's follow must not have stuck.
        assertFalse(registry.isFollowing(id1, follower));
    }

    // ── deactivate / reactivate ─────────────────────────────────────────

    function test_deactivateTrader_onlyTraderWallet() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");

        vm.prank(other);
        vm.expectRevert(TraderRegistry.NotTraderWallet.selector);
        registry.deactivateTrader(id);

        vm.prank(trader);
        registry.deactivateTrader(id);
        assertFalse(registry.getTrader(id).active);
    }

    function test_reactivateTrader_onlyTraderWallet() public {
        vm.startPrank(trader);
        uint256 id = registry.registerTrader("alpha-desk");
        registry.deactivateTrader(id);
        registry.reactivateTrader(id);
        vm.stopPrank();

        assertTrue(registry.getTrader(id).active);
    }

    // ── getTrader ────────────────────────────────────────────────────────

    function test_getTrader_revertsOnUnknownId() public {
        vm.expectRevert(TraderNotFound.selector);
        registry.getTrader(42);
    }

    // ── setCopyVault / recordTradeResult / getWinRate ───────────────────

    function test_setCopyVault_onlyOwner() public {
        address fakeCopyVault = makeAddr("fakeCopyVault");
        vm.prank(follower);
        vm.expectRevert();
        registry.setCopyVault(fakeCopyVault);

        // test contract is the owner by default (deployed it in setUp).
        registry.setCopyVault(fakeCopyVault);
        assertEq(registry.copyVault(), fakeCopyVault);
    }

    function test_recordTradeResult_onlyCopyVault() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");

        address fakeCopyVault = makeAddr("fakeCopyVault");
        registry.setCopyVault(fakeCopyVault);

        vm.prank(follower); // not the wired copyVault
        vm.expectRevert(TraderRegistry.OnlyCopyVault.selector);
        registry.recordTradeResult(id, true);

        vm.prank(fakeCopyVault);
        registry.recordTradeResult(id, true);
        assertEq(registry.getWinRate(id), 100);
    }

    function test_getWinRate_zeroTradesReturnsZero() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");
        assertEq(registry.getWinRate(id), 0);
    }

    function test_getWinRate_calculatesAtBoundaries() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");

        address fakeCopyVault = makeAddr("fakeCopyVault");
        registry.setCopyVault(fakeCopyVault);

        // 6 wins, 4 losses = exactly 60%.
        vm.startPrank(fakeCopyVault);
        for (uint256 i = 0; i < 6; i++) {
            registry.recordTradeResult(id, true);
        }
        for (uint256 i = 0; i < 4; i++) {
            registry.recordTradeResult(id, false);
        }
        vm.stopPrank();

        (uint256 totalTrades, uint256 winningTrades,) = registry.performance(id);
        assertEq(totalTrades, 10);
        assertEq(winningTrades, 6);
        assertEq(registry.getWinRate(id), 60);
    }

    function test_recordTradeResult_emitsWithRunningTotals() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");
        address fakeCopyVault = makeAddr("fakeCopyVault");
        registry.setCopyVault(fakeCopyVault);

        vm.expectEmit(true, false, false, true);
        emit TraderRegistry.TradeResultRecorded(id, true, 1, 1);

        vm.prank(fakeCopyVault);
        registry.recordTradeResult(id, true);
    }

    // ── recordPnL ────────────────────────────────────────────────────────

    function test_recordPnL_onlyCopyVault() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");
        address fakeCopyVault = makeAddr("fakeCopyVault");
        registry.setCopyVault(fakeCopyVault);

        vm.prank(follower);
        vm.expectRevert(TraderRegistry.OnlyCopyVault.selector);
        registry.recordPnL(id, 100e18, 1000e18);
    }

    function test_recordPnL_accumulatesAcrossMultipleTrades() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");
        address fakeCopyVault = makeAddr("fakeCopyVault");
        registry.setCopyVault(fakeCopyVault);

        vm.startPrank(fakeCopyVault);
        registry.recordPnL(id, 50e18, 1000e18); // +50 profit, 1000 volume
        registry.recordPnL(id, 30e18, 500e18); // +30 profit, 500 volume
        vm.stopPrank();

        (int256 realizedPnL, uint256 totalVolume, uint256 bestTrade) = registry.traderPnL(id);
        assertEq(realizedPnL, 80e18);
        assertEq(totalVolume, 1500e18);
        assertEq(bestTrade, 50e18); // largest single win, not the sum
    }

    function test_recordPnL_negativePnLTrackedCorrectly() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");
        address fakeCopyVault = makeAddr("fakeCopyVault");
        registry.setCopyVault(fakeCopyVault);

        vm.startPrank(fakeCopyVault);
        registry.recordPnL(id, 50e18, 1000e18); // +50
        registry.recordPnL(id, -80e18, 800e18); // -80 -> net negative
        vm.stopPrank();

        (int256 realizedPnL, uint256 totalVolume, uint256 bestTrade) = registry.traderPnL(id);
        assertEq(realizedPnL, -30e18);
        assertEq(totalVolume, 1800e18);
        assertEq(bestTrade, 50e18); // the loss never counts as a "best trade"
    }

    // ── getFollowers ─────────────────────────────────────────────────────

    function test_getFollowers_returnsOnlyCurrentFollowers() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        vm.prank(alice);
        registry.follow(id);
        vm.prank(bob);
        registry.follow(id);

        address[] memory followers = registry.getFollowers(id);
        assertEq(followers.length, 2);
        assertEq(followers[0], alice);
        assertEq(followers[1], bob);

        vm.prank(alice);
        registry.unfollow(id);

        address[] memory afterUnfollow = registry.getFollowers(id);
        assertEq(afterUnfollow.length, 1);
        assertEq(afterUnfollow[0], bob);
    }

    function test_getFollowers_reFollowingDoesNotDuplicate() public {
        vm.prank(trader);
        uint256 id = registry.registerTrader("alpha-desk");

        vm.startPrank(follower);
        registry.follow(id);
        registry.unfollow(id);
        registry.follow(id);
        vm.stopPrank();

        address[] memory followers = registry.getFollowers(id);
        assertEq(followers.length, 1);
        assertEq(followers[0], follower);
    }
}
