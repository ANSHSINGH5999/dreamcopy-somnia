// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The one call CopyVault needs into ReferralRegistry — see
/// ReferralRegistry.sol and CopyVault.depositWithReferral.
interface IReferralRegistry {
    function registerReferral(address referee, address referrer, uint256 feeAmount) external;
}
