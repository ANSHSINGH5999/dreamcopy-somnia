// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IReferralRegistry} from "./interfaces/IReferralRegistry.sol";

/// @notice Tracks referral relationships and holds/pays out the 0.5%
/// first-deposit referral fee CopyVault forwards here (see
/// CopyVault.depositWithReferral, REFERRAL_FEE_BPS). `copyVault` is
/// immutable — deploy this AFTER CopyVault (see docs/ARCHITECTURE.md's
/// deploy order), then call CopyVault.setReferralRegistry with this
/// contract's address to complete the wiring.
contract ReferralRegistry is IReferralRegistry {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error OnlyCopyVault();
    error AlreadyReferred();
    error SelfReferral();

    event ReferralRegistered(address indexed referee, address indexed referrer, uint256 feeAmount);
    event EarningsClaimed(address indexed referrer, uint256 amount);

    IERC20 public immutable collateralToken;
    address public immutable copyVault;

    mapping(address referee => address referrer) public referredBy;
    mapping(address referrer => uint256 count) public referralCount;
    mapping(address referrer => uint256 earnings) public referralEarnings;

    /// @notice Every address that has ever earned at least one referral,
    /// in first-seen order. Lets a "top referrers" leaderboard read this
    /// on-chain directly (loop + referralCount) instead of scanning event
    /// logs — this chain's RPC caps eth_getLogs at a 1000-block range and
    /// is already past block 475M, so full-history log scanning from a
    /// client is not viable here (confirmed against the live RPC, not
    /// assumed).
    address[] public referrers;
    mapping(address referrer => bool seen) private _isKnownReferrer;

    function referrerCount() external view returns (uint256) {
        return referrers.length;
    }

    modifier onlyCopyVault() {
        if (msg.sender != copyVault) revert OnlyCopyVault();
        _;
    }

    constructor(address _collateralToken, address _copyVault) {
        if (_collateralToken == address(0) || _copyVault == address(0)) revert ZeroAddress();
        collateralToken = IERC20(_collateralToken);
        copyVault = _copyVault;
    }

    /// @notice Records referee->referrer for the referee's first deposit and
    /// credits the referrer's claimable earnings. Only CopyVault can call
    /// this — it already transferred `feeAmount` of collateralToken to this
    /// contract in the same transaction. Reverts if referee already has a
    /// referrer: only the first-ever referral for a given referee sticks.
    function registerReferral(address referee, address referrer, uint256 feeAmount) external onlyCopyVault {
        if (referrer == address(0) || referee == address(0)) revert ZeroAddress();
        if (referrer == referee) revert SelfReferral();
        if (referredBy[referee] != address(0)) revert AlreadyReferred();

        referredBy[referee] = referrer;
        referralCount[referrer] += 1;
        referralEarnings[referrer] += feeAmount;
        if (!_isKnownReferrer[referrer]) {
            _isKnownReferrer[referrer] = true;
            referrers.push(referrer);
        }

        emit ReferralRegistered(referee, referrer, feeAmount);
    }

    /// @notice Transfers the caller's full claimable referral earnings to
    /// themselves.
    function claimEarnings() external {
        uint256 amount = referralEarnings[msg.sender];
        if (amount == 0) revert ZeroAmount();
        referralEarnings[msg.sender] = 0;
        collateralToken.safeTransfer(msg.sender, amount);
        emit EarningsClaimed(msg.sender, amount);
    }
}
