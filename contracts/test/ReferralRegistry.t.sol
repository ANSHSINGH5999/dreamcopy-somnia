// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReferralRegistry} from "../src/ReferralRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract ReferralRegistryTest is Test {
    ReferralRegistry internal registry;
    MockERC20 internal usdso;

    address internal copyVault = makeAddr("copyVault");
    address internal referrer = makeAddr("referrer");
    address internal referee = makeAddr("referee");

    function setUp() public {
        usdso = new MockERC20("USD Somnia", "USDso");
        registry = new ReferralRegistry(address(usdso), copyVault);
        usdso.mint(address(registry), 1_000e18); // simulate CopyVault having forwarded fees here
    }

    function test_constructor_revertsOnZeroAddresses() public {
        vm.expectRevert(ReferralRegistry.ZeroAddress.selector);
        new ReferralRegistry(address(0), copyVault);

        vm.expectRevert(ReferralRegistry.ZeroAddress.selector);
        new ReferralRegistry(address(usdso), address(0));
    }

    function test_registerReferral_onlyCopyVault() public {
        vm.prank(referee);
        vm.expectRevert(ReferralRegistry.OnlyCopyVault.selector);
        registry.registerReferral(referee, referrer, 5e18);
    }

    function test_registerReferral_setsUpEarningsAndCount() public {
        vm.prank(copyVault);
        registry.registerReferral(referee, referrer, 5e18);

        assertEq(registry.referredBy(referee), referrer);
        assertEq(registry.referralCount(referrer), 1);
        assertEq(registry.referralEarnings(referrer), 5e18);
    }

    function test_registerReferral_revertsOnSelfReferral() public {
        vm.prank(copyVault);
        vm.expectRevert(ReferralRegistry.SelfReferral.selector);
        registry.registerReferral(referee, referee, 5e18);
    }

    function test_registerReferral_revertsOnDoubleReferral() public {
        vm.startPrank(copyVault);
        registry.registerReferral(referee, referrer, 5e18);

        address otherReferrer = makeAddr("otherReferrer");
        vm.expectRevert(ReferralRegistry.AlreadyReferred.selector);
        registry.registerReferral(referee, otherReferrer, 5e18);
        vm.stopPrank();

        // The original referral is untouched.
        assertEq(registry.referredBy(referee), referrer);
    }

    function test_claimEarnings_transfersCorrectAmountAndZeroesBalance() public {
        vm.prank(copyVault);
        registry.registerReferral(referee, referrer, 5e18);

        vm.prank(referrer);
        registry.claimEarnings();

        assertEq(usdso.balanceOf(referrer), 5e18);
        assertEq(registry.referralEarnings(referrer), 0);
    }

    function test_claimEarnings_revertsWhenNothingToClaim() public {
        vm.prank(referrer);
        vm.expectRevert(ReferralRegistry.ZeroAmount.selector);
        registry.claimEarnings();
    }

    function test_referrers_enumerableOnChainWithoutDuplicates() public {
        address referee2 = makeAddr("referee2");
        vm.startPrank(copyVault);
        registry.registerReferral(referee, referrer, 5e18);
        registry.registerReferral(referee2, referrer, 3e18); // same referrer again
        vm.stopPrank();

        assertEq(registry.referrerCount(), 1); // not duplicated
        assertEq(registry.referrers(0), referrer);
    }

    function test_referrers_multipleDistinctReferrersEnumerated() public {
        address referrer2 = makeAddr("referrer2");
        address referee2 = makeAddr("referee2");
        vm.startPrank(copyVault);
        registry.registerReferral(referee, referrer, 5e18);
        registry.registerReferral(referee2, referrer2, 2e18);
        vm.stopPrank();

        assertEq(registry.referrerCount(), 2);
        assertEq(registry.referrers(0), referrer);
        assertEq(registry.referrers(1), referrer2);
    }

    function test_claimEarnings_accumulatesAcrossMultipleReferees() public {
        address referee2 = makeAddr("referee2");
        vm.startPrank(copyVault);
        registry.registerReferral(referee, referrer, 5e18);
        registry.registerReferral(referee2, referrer, 3e18);
        vm.stopPrank();

        assertEq(registry.referralCount(referrer), 2);
        assertEq(registry.referralEarnings(referrer), 8e18);

        vm.prank(referrer);
        registry.claimEarnings();
        assertEq(usdso.balanceOf(referrer), 8e18);
    }
}
