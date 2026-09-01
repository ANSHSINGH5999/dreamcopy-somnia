// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A trader profile in TraderRegistry. `wallet` is the on-chain
/// address whose DreamDEX fills the indexer watches; `active` gates both new
/// follows and new CopyVault.executeCopy() calls for this trader.
struct Trader {
    address wallet;
    string label;
    bool active;
    uint256 followerCount;
}

/// @notice Errors shared between TraderRegistry and CopyVault so both
/// contracts fail the same way for the same conceptual problem (e.g. a
/// CopyVault call against a trader id TraderRegistry has never seen).
error TraderNotFound();
error TraderInactive();
