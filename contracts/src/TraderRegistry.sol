// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {Trader, TraderNotFound, TraderInactive} from "./CopyTypes.sol";

/// @notice On-chain registry of followable trader wallets and who follows
/// them. This is the source of truth the indexer reads (via events/view
/// calls) to know which DreamDEX wallets to watch, and that CopyVault reads
/// to authorize deposits/withdrawals. Registration is self-service and
/// permissionless by design: a trader "registering" only publishes a label
/// for their own wallet, it grants no privilege over anyone else's funds.
///
/// The one privileged piece is `copyVault` (below) — added so
/// `recordTradeResult` can be gated to the real CopyVault contract, not the
/// weaker "executor" wallet concept CopyVault itself uses (an executor
/// address is reassignable independently and doesn't represent "this call
/// really came from a completed trade"). Ownable exists solely to set that
/// one address; nothing else here requires any privilege.
contract TraderRegistry is Ownable {
    error TraderAlreadyRegistered();
    error NotTraderWallet();
    error AlreadyFollowing();
    error NotFollowing();
    error EmptyLabel();
    error ZeroAddress();
    error OnlyCopyVault();

    event TraderRegistered(uint256 indexed traderId, address indexed wallet, string label);
    event TraderDeactivated(uint256 indexed traderId);
    event TraderReactivated(uint256 indexed traderId);
    event Followed(uint256 indexed traderId, address indexed follower);
    event Unfollowed(uint256 indexed traderId, address indexed follower);
    event CopyVaultUpdated(address indexed copyVault);
    event TradeResultRecorded(uint256 indexed traderId, bool won, uint256 totalTrades, uint256 winningTrades);
    event PnLRecorded(uint256 indexed traderId, int256 pnlDelta, uint256 volume, int256 realizedPnL);

    /// @dev traderId 0 is never assigned — used as the "unregistered" sentinel
    /// in `traderIdByWallet`.
    uint256 public traderCount;

    mapping(uint256 traderId => Trader) private _traders;
    mapping(address wallet => uint256 traderId) public traderIdByWallet;
    mapping(uint256 traderId => mapping(address follower => bool)) public isFollowing;

    /// @notice The only address allowed to call `recordTradeResult` — set by
    /// the owner once CopyVault is deployed (this contract must exist
    /// before CopyVault can be constructed, so it can't be an immutable
    /// constructor arg — see docs/ARCHITECTURE.md's deploy order).
    address public copyVault;

    struct Performance {
        uint256 totalTrades;
        uint256 winningTrades;
        uint256 lastUpdated;
    }

    /// @notice Win/loss record per trader, fed by CopyVault after every SELL
    /// fill. Only SELLs are recorded — a BUY has no realized P&L to judge
    /// yet (no price oracle; see docs/LIMITATIONS.md), so "won" is always
    /// computed as `outputReceived >= basisReleased` on a sell, never on a
    /// buy. Badge tiers (Verified/Rising) are a pure derived view over this
    /// — computed client-side from getWinRate + totalTrades, no extra
    /// on-chain storage needed for them.
    mapping(uint256 traderId => Performance) public performance;

    struct PnL {
        int256 realizedPnL; // cumulative, signed, collateralToken (USDso) units
        uint256 totalVolume; // sum of every fill's exact collateral-side amount — BOTH bids and sells
        uint256 bestTrade; // largest single positive pnlDelta seen
    }

    /// @notice Realized P&L / volume record per trader, fed by CopyVault
    /// after EVERY fill (unlike `performance`, which only records SELLs).
    /// `volume` is exact, not estimated: CopyVault passes inputSpent (a
    /// BID's exact collateral cost) or outputReceived (a SELL's exact
    /// collateral proceeds) — both are already collateral-denominated
    /// on-chain, no price/decimals guessing needed the way an off-chain
    /// observer would have to (contrast the analytics dashboard's
    /// notionalUsdso, which DOES have to estimate — see
    /// web/src/lib/marketDecimals.ts). `pnlDelta` is 0 for a BID (no
    /// realized P&L until a matching sell — no price oracle; see
    /// docs/LIMITATIONS.md) and `outputReceived - basisReleased` for a
    /// SELL, matching `performance`'s "won" computation exactly.
    mapping(uint256 traderId => PnL) public traderPnL;

    /// @dev Every address that has ever followed traderId, first-seen
    /// order — lets `getFollowers` enumerate CURRENT followers on-chain
    /// (filtered live by isFollowing) without event-log scanning. Needed
    /// because this RPC caps eth_getLogs at a 1000-block range on a chain
    /// already past block 475M — confirmed against the live RPC, not
    /// assumed (see ReferralRegistry.sol's `referrers` array, the same
    /// fix for the same problem). Entries are never removed on unfollow;
    /// getFollowers filters them out at read time instead.
    mapping(uint256 traderId => address[]) private _everFollowed;
    mapping(uint256 traderId => mapping(address follower => bool)) private _hasEverFollowed;

    constructor() Ownable(msg.sender) {}

    /// @notice One-time (or updatable, if CopyVault is ever redeployed)
    /// wiring of the trusted CopyVault address.
    function setCopyVault(address _copyVault) external onlyOwner {
        if (_copyVault == address(0)) revert ZeroAddress();
        copyVault = _copyVault;
        emit CopyVaultUpdated(_copyVault);
    }

    /// @notice Records one SELL's win/loss outcome for traderId. Only
    /// callable by the wired CopyVault contract, once per completed sell —
    /// see CopyVault.executeCopy.
    function recordTradeResult(uint256 traderId, bool won) external {
        if (msg.sender != copyVault) revert OnlyCopyVault();
        Performance storage p = performance[traderId];
        p.totalTrades += 1;
        if (won) p.winningTrades += 1;
        p.lastUpdated = block.timestamp;
        emit TradeResultRecorded(traderId, won, p.totalTrades, p.winningTrades);
    }

    /// @notice Win rate as a 0-100 percentage. 0 if no trades recorded yet.
    function getWinRate(uint256 traderId) external view returns (uint256 pct) {
        Performance memory p = performance[traderId];
        if (p.totalTrades == 0) return 0;
        return (p.winningTrades * 100) / p.totalTrades;
    }

    /// @notice Records one fill's exact P&L impact and volume. Only
    /// callable by the wired CopyVault contract, once per fill (both bids
    /// and sells) — see CopyVault.executeCopy.
    function recordPnL(uint256 traderId, int256 pnlDelta, uint256 volume) external {
        if (msg.sender != copyVault) revert OnlyCopyVault();
        PnL storage p = traderPnL[traderId];
        p.realizedPnL += pnlDelta;
        p.totalVolume += volume;
        if (pnlDelta > 0 && uint256(pnlDelta) > p.bestTrade) {
            // forge-lint: disable-next-line(unsafe-typecast)
            // safe: pnlDelta > 0 was just checked, so it fits in uint256 exactly.
            p.bestTrade = uint256(pnlDelta);
        }
        emit PnLRecorded(traderId, pnlDelta, volume, p.realizedPnL);
    }

    /// @notice Every wallet currently following traderId — see
    /// `_everFollowed`'s doc comment for why this exists instead of
    /// scanning Followed/Unfollowed events.
    function getFollowers(uint256 traderId) external view returns (address[] memory) {
        address[] storage ever = _everFollowed[traderId];
        uint256 count;
        for (uint256 i = 0; i < ever.length; i++) {
            if (isFollowing[traderId][ever[i]]) count++;
        }
        address[] memory result = new address[](count);
        uint256 j;
        for (uint256 i = 0; i < ever.length; i++) {
            if (isFollowing[traderId][ever[i]]) {
                result[j++] = ever[i];
            }
        }
        return result;
    }

    /// @notice Register the caller's own wallet as a followable trader.
    function registerTrader(string calldata label) external returns (uint256 traderId) {
        if (traderIdByWallet[msg.sender] != 0) revert TraderAlreadyRegistered();
        if (bytes(label).length == 0) revert EmptyLabel();

        traderId = ++traderCount;
        _traders[traderId] = Trader({wallet: msg.sender, label: label, active: true, followerCount: 0});
        traderIdByWallet[msg.sender] = traderId;

        emit TraderRegistered(traderId, msg.sender, label);
    }

    /// @notice Pause a trader profile. Blocks new follows and new
    /// CopyVault.executeCopy() calls for this trader; existing followers keep
    /// their shares and can still withdraw idle collateral.
    function deactivateTrader(uint256 traderId) external {
        Trader storage t = _getTraderStorage(traderId);
        if (t.wallet != msg.sender) revert NotTraderWallet();
        t.active = false;
        emit TraderDeactivated(traderId);
    }

    function reactivateTrader(uint256 traderId) external {
        Trader storage t = _getTraderStorage(traderId);
        if (t.wallet != msg.sender) revert NotTraderWallet();
        t.active = true;
        emit TraderReactivated(traderId);
    }

    /// @notice Follow a trader. Does not move funds — see CopyVault.deposit
    /// for funding a followed trader's pool.
    function follow(uint256 traderId) external {
        _follow(traderId);
    }

    /// @notice Follow multiple traders in one transaction. Reverts on the
    /// first entry that fails follow()'s own checks (inactive trader,
    /// already following) — same semantics as calling follow() in a loop
    /// yourself, just cheaper. Does not move funds, same as follow().
    ///
    /// This lives here rather than on CopyVault deliberately: `follow`
    /// relies on `msg.sender` to know who's following. If CopyVault called
    /// registry.follow(traderId) on a user's behalf, msg.sender as seen by
    /// this contract would be CopyVault's own address, not the real user —
    /// it would mark CopyVault itself as the follower for every caller,
    /// silently breaking isFollowing for everyone. Calling this directly
    /// keeps msg.sender correct.
    function followMultiple(uint256[] calldata traderIds) external {
        for (uint256 i = 0; i < traderIds.length; i++) {
            _follow(traderIds[i]);
        }
    }

    function _follow(uint256 traderId) internal {
        Trader storage t = _getTraderStorage(traderId);
        if (!t.active) revert TraderInactive();
        if (isFollowing[traderId][msg.sender]) revert AlreadyFollowing();

        isFollowing[traderId][msg.sender] = true;
        t.followerCount += 1;

        if (!_hasEverFollowed[traderId][msg.sender]) {
            _hasEverFollowed[traderId][msg.sender] = true;
            _everFollowed[traderId].push(msg.sender);
        }

        emit Followed(traderId, msg.sender);
    }

    function unfollow(uint256 traderId) external {
        Trader storage t = _getTraderStorage(traderId);
        if (!isFollowing[traderId][msg.sender]) revert NotFollowing();

        isFollowing[traderId][msg.sender] = false;
        t.followerCount -= 1;

        emit Unfollowed(traderId, msg.sender);
    }

    function getTrader(uint256 traderId) external view returns (Trader memory) {
        return _getTrader(traderId);
    }

    function _getTraderStorage(uint256 traderId) internal view returns (Trader storage t) {
        t = _traders[traderId];
        if (t.wallet == address(0)) revert TraderNotFound();
    }

    function _getTrader(uint256 traderId) internal view returns (Trader memory t) {
        t = _traders[traderId];
        if (t.wallet == address(0)) revert TraderNotFound();
    }
}
