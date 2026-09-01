// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TraderRegistry} from "../src/TraderRegistry.sol";
import {CopyVault} from "../src/CopyVault.sol";

/// @notice Deploys TraderRegistry + CopyVault. `collateralToken` MUST be
/// fetched fresh from `GET https://stg.api.dreamdex.io/v0/markets` (the
/// `quote` field) immediately before running this — see docs/ARCHITECTURE.md
/// — never hard-coded here. No pool is allow-listed by this script; run
/// `setApprovedPool` separately per market once you've fetched and verified
/// its `contract` address from the same endpoint.
contract Deploy is Script {
    function run() external returns (TraderRegistry registry, CopyVault vault) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address collateralToken = vm.envAddress("COLLATERAL_TOKEN");
        address executor = vm.envAddress("EXECUTOR_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");

        vm.startBroadcast(deployerKey);

        registry = new TraderRegistry();
        vault = new CopyVault(collateralToken, address(registry), executor, owner);

        vm.stopBroadcast();

        console.log("TraderRegistry deployed at:", address(registry));
        console.log("CopyVault deployed at:", address(vault));
        console.log("Collateral token:", collateralToken);
        console.log("Executor:", executor);
        console.log("Owner:", owner);
        console.log("");
        console.log("Next: allow-list DreamDEX pools via setApprovedPool(pool, true),");
        console.log("using addresses fetched live from GET /v0/markets.");
    }
}
