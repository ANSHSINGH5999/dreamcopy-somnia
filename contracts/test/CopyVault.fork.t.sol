// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IDreamDEXPool} from "../src/interfaces/IDreamDEX.sol";

/// @notice Fork test: calls `getPoolParams()` and `getAutoPullRequirement()`
/// on the REAL, live WETH:USDso SpotPool deployed on Somnia testnet (address
/// fetched from `GET https://stg.api.dreamdex.io/v0/markets` on 2026-08-30 —
/// see docs/ARCHITECTURE.md for the exact response). This is not a unit test
/// of CopyVault's logic (see CopyVault.t.sol for that, against
/// MockDreamDEXPool) — it exists solely to prove IDreamDEXPool.sol's function
/// selectors and return types actually match the bytecode DreamDEX has
/// deployed, not just the bot-kit's TypeScript ABI. If DreamDEX changes the
/// pool contract's interface, this test breaks loudly instead of CopyVault
/// silently reverting or misdecoding in production.
///
/// Requires network access to https://dream-rpc.somnia.network. Not run by
/// the default `forge test` (see the run command below) so CI/offline runs
/// of the unit suite are never network-flaky.
contract CopyVaultForkTest is Test {
    // WETH:USDso pool on Somnia testnet, from the live /v0/markets response.
    address constant WETH_USDSO_POOL = 0xD180195da5459C7a0DEA188ed61216ec43682b50;
    address constant EXPECTED_BASE = 0x4d8E02BBfCf205828A8352Af4376b165E123D7b0; // WETH
    address constant EXPECTED_QUOTE = 0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171; // USDso

    function setUp() public {
        vm.createSelectFork(vm.envOr("SOMNIA_TESTNET_RPC", string("https://dream-rpc.somnia.network")));
    }

    function test_fork_getPoolParams_matchesLiveMarketsApi() public view {
        IDreamDEXPool pool = IDreamDEXPool(WETH_USDSO_POOL);

        (address base, address quote,,, uint256 tickSize, uint256 minQuantity, uint256 lotSize) = pool.getPoolParams();

        assertEq(base, EXPECTED_BASE, "base token mismatch vs /v0/markets");
        assertEq(quote, EXPECTED_QUOTE, "quote token mismatch vs /v0/markets");
        // Sanity only — these move with market config, just confirm they're set.
        assertGt(tickSize, 0);
        assertGt(minQuantity, 0);
        assertGt(lotSize, 0);
    }

    function test_fork_getAutoPullRequirement_decodesAgainstRealContract() public view {
        IDreamDEXPool pool = IDreamDEXPool(WETH_USDSO_POOL);

        // A throwaway bid: does the live contract accept this call shape and
        // return the (inputToken, requiredAmount, delta) tuple our interface
        // declares, without reverting on ABI mismatch?
        (address inputToken, uint256 requiredAmount,) =
            pool.getAutoPullRequirement(address(this), true, 3_000e18, 1e15, 0);

        assertEq(inputToken, EXPECTED_QUOTE, "bid input token should be the quote token");
        assertGt(requiredAmount, 0);
    }
}
