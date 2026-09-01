// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

import {Trader, TraderNotFound, TraderInactive} from "./CopyTypes.sol";
import {TraderRegistry} from "./TraderRegistry.sol";
import {IDreamDEXPool, DREAMDEX_NATIVE_SENTINEL} from "./interfaces/IDreamDEX.sol";
import {IReferralRegistry} from "./interfaces/IReferralRegistry.sol";

/// @notice Non-custodial, share-based copy-trading vault for one collateral
/// asset across every trader tracked in a TraderRegistry.
///
/// Design (see docs/ARCHITECTURE.md and docs/LIMITATIONS.md for the full
/// reasoning, including why this isn't a floating-NAV / oracle-priced vault):
///
///  - One CopyVault holds pooled funds for EVERY trader, partitioned
///    internally per `traderId`. Each trader's pool is its own share class:
///    depositing into trader A's pool never exposes you to trader B's fills.
///  - Followers deposit `collateralToken` (an ERC-20 — see LIMITATIONS.md for
///    why this is not native STT) and receive shares of that trader's pool.
///    Only an address currently following the trader (per TraderRegistry) may
///    deposit into that trader's pool.
///  - `executeCopy` is called by a single trusted `executor` (the indexer's
///    hot wallet) once per detected trader fill, sized however the indexer
///    computes proportional sizing off-chain. Followers automatically get
///    proportional exposure to that trade via their existing share of the
///    pool — no per-follower on-chain call is needed.
///  - The executor can only ever trigger trades with pool funds; it can never
///    withdraw them. `withdraw` always pays the caller, gated by their own
///    share balance. That's the non-custodial boundary this contract
///    enforces: trade-only authority, never transfer-out authority.
///  - No price oracle: shares are priced off `poolNav = idle collateral +
///    tracked cost basis of the pool's currently open position`, not
///    mark-to-market. Profit/loss is only realized (and only then reflected
///    in NAV) when a position is actually sold back to collateral. This is a
///    deliberate scope cut, not an oversight — see LIMITATIONS.md.
///  - `executeCopy` reverts on any order whose auto-pulled input is the
///    native-token sentinel (see IDreamDEX.sol) rather than silently
///    mishandling native funds — see LIMITATIONS.md for which live markets
///    this excludes and why.
contract CopyVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error ZeroShares();
    error NotFollowingTrader();
    error PoolNotApproved();
    error NativeSettlementNotSupported();
    error OrderRejected();
    error UnexpectedInputToken();
    error InsufficientPoolBalance();
    error InsufficientIdleBalance();
    error InsufficientShares();
    error NotExecutor();
    error ArrayLengthMismatch();
    error AllocationExceeds100();
    error InvalidMaxAllocationPct();
    error CopyingPausedByRiskParams();
    error MaxLossExceeded();
    error InvalidStopLossPct();
    error SelfReferral();

    event Deposited(uint256 indexed traderId, address indexed follower, uint256 amount, uint256 shares);
    event Withdrawn(uint256 indexed traderId, address indexed follower, uint256 amount, uint256 shares);
    event PoolApprovalSet(address indexed pool, bool approved);
    event ExecutorUpdated(address indexed executor);
    event AllocationsSet(address indexed follower, uint256[] traderIds, uint256[] allocationPcts);
    event RiskParamsSet(
        uint256 indexed traderId, uint256 maxLossPerTrade, uint256 maxAllocationPct, bool pauseCopying
    );
    event StopLossSet(uint256 indexed traderId, uint256 pct);
    event StopLossTriggered(uint256 indexed traderId, uint256 cumulativeLoss);
    event FollowerCopyingPaused(address indexed follower, uint256 indexed traderId);
    event FollowerCopyingResumed(address indexed follower, uint256 indexed traderId);
    event ReferralRegistrySet(address indexed referralRegistry);
    event CopyExecuted(
        uint256 indexed traderId,
        address indexed pool,
        bool isBid,
        uint128 orderId,
        address inputToken,
        uint256 inputSpent,
        address outputToken,
        uint256 outputReceived
    );

    /// @notice The single ERC-20 followers deposit and withdraw. Set once at
    /// deployment from a market's quote token, fetched off-chain from
    /// `GET /v0/markets` — never hard-coded in source (see deploy script).
    IERC20 public immutable collateralToken;
    TraderRegistry public immutable registry;

    /// @notice The only address allowed to call `executeCopy`. Can trade
    /// pooled funds; cannot withdraw them (see contract-level docs above).
    address public executor;

    /// @notice DreamDEX pool contracts this vault is willing to trade
    /// against, allow-listed by the owner after fetching+verifying them from
    /// `GET /v0/markets` (see docs/ARCHITECTURE.md). `executeCopy` never
    /// trusts a pool address supplied only at call time without this check —
    /// that would let a compromised/malicious executor point the vault at an
    /// arbitrary contract to drain funds.
    mapping(address pool => bool) public isApprovedPool;

    mapping(uint256 traderId => uint256 totalShares) public totalSharesOf;
    mapping(uint256 traderId => mapping(address follower => uint256 shares)) public sharesOf;

    /// @notice A follower's declared allocation intent for a trader's pool,
    /// as a percentage (0-100) of their total portfolio. Purely advisory
    /// bookkeeping — see setAllocations for why this never moves funds by
    /// itself: rebalancing to match a new split still requires the follower
    /// (or the frontend, on their behalf) to call withdraw/deposit
    /// themselves, subject to the idle-collateral constraint on withdraw.
    mapping(address follower => mapping(uint256 traderId => uint256 pct)) public allocationPctOf;

    /// @dev Per-trader-pool ledger of every token it currently holds
    /// (collateralToken while idle, plus whatever base token a fill leaves it
    /// holding). Keyed by traderId so two pools trading the same base token
    /// concurrently never share balance.
    mapping(uint256 traderId => mapping(address token => uint256 balance)) public tokenBalance;

    /// @dev Aggregate cost basis (in collateralToken terms) of a trader
    /// pool's currently open position(s). See contract-level docs: NAV uses
    /// this instead of a live mark-to-market price.
    mapping(uint256 traderId => uint256 costBasis) public deployedCostBasis;

    struct RiskParams {
        uint256 maxLossPerTrade; // collateralToken units. 0 = disabled.
        uint256 maxAllocationPct; // 1-100, % of pool NAV a single BID may deploy. 0 = disabled.
        bool pauseCopying;
    }

    /// @notice Pool-wide risk guardrails per traderId — NOT per-follower.
    /// executeCopy trades a trader's entire pooled balance in one call, so
    /// there is no single "the follower" to key this by; a per-follower
    /// version would need to enumerate every follower with a setting inside
    /// executeCopy (unbounded loop, real gas risk) and apply the strictest
    /// one to the whole pool's trade anyway, which one paranoid follower
    /// would use to block copying for everyone else. This is instead a
    /// protocol-level circuit breaker the owner sets for that trader's pool.
    mapping(uint256 traderId => RiskParams) public riskParams;

    /// @notice Pool-wide stop-loss threshold, as % of current pool NAV. 0 =
    /// disabled. Same "pool-wide, not per-follower" reasoning as RiskParams
    /// — see its doc comment. When cumulativeLoss[traderId] exceeds this
    /// threshold, riskParams[traderId].pauseCopying is automatically set to
    /// true (reusing Feature 2's existing enforced circuit breaker) rather
    /// than trying to "auto-unfollow" — there is no single follower to
    /// unfollow for a pooled trade, and TraderRegistry.unfollow can only
    /// ever be called by the real follower themselves (same msg.sender
    /// reasoning as followMultiple's doc comment).
    mapping(uint256 traderId => uint256 pct) public stopLossPct;

    /// @dev Running total of realized losses (collateralToken units) since
    /// the pool was created or last reset. Only increases — accumulated
    /// from the same per-sell realized-loss computation RiskParams.
    /// maxLossPerTrade uses, just summed over time instead of checked once.
    mapping(uint256 traderId => uint256 loss) public cumulativeLoss;

    /// @notice A follower's own, personal "pause my copying" preference for
    /// one trader's pool. UNLIKE RiskParams.pauseCopying, this is
    /// deliberately per-follower — but for that exact reason it is
    /// ADVISORY ONLY and is NOT checked inside executeCopy: a pooled trade
    /// moves the entire pool's funds in one call, so honoring one
    /// follower's personal pause would either require enumerating every
    /// follower with a preference set (unbounded loop, gas risk) or would
    /// block copying for every OTHER follower too, which defeats the point
    /// of it being personal. If you want to stop being exposed to future
    /// trades for real, withdraw your idle collateral via `withdraw` — this
    /// flag is for UI/informational use (and future off-chain tooling), not
    /// fund-level enforcement.
    mapping(address follower => mapping(uint256 traderId => bool paused)) public copyingPaused;

    /// @notice ReferralRegistry address, settable post-deploy (not
    /// immutable) because ReferralRegistry's own constructor needs this
    /// contract's address — see docs/ARCHITECTURE.md's deploy order.
    address public referralRegistry;

    uint256 public constant REFERRAL_FEE_BPS = 50; // 0.5%

    /// @notice Whether `wallet` has ever completed a deposit (either
    /// `deposit` or `depositWithReferral`), across every trader pool.
    /// Determines "first deposit" for the referral fee — see
    /// depositWithReferral.
    mapping(address wallet => bool) public hasEverDeposited;

    modifier onlyExecutor() {
        if (msg.sender != executor) revert NotExecutor();
        _;
    }

    constructor(address _collateralToken, address _registry, address _executor, address _owner) Ownable(_owner) {
        if (_collateralToken == address(0) || _registry == address(0) || _executor == address(0)) {
            revert ZeroAddress();
        }
        collateralToken = IERC20(_collateralToken);
        registry = TraderRegistry(_registry);
        executor = _executor;
        emit ExecutorUpdated(_executor);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────

    function setExecutor(address newExecutor) external onlyOwner {
        if (newExecutor == address(0)) revert ZeroAddress();
        executor = newExecutor;
        emit ExecutorUpdated(newExecutor);
    }

    /// @notice Allow- or deny-list a DreamDEX pool contract for `executeCopy`.
    /// The owner should only approve an address obtained by fetching
    /// `GET /v0/markets` and confirming the `contract` field for the intended
    /// market, per rule: never hard-code, always fetch at runtime.
    function setApprovedPool(address pool, bool approved) external onlyOwner {
        if (pool == address(0)) revert ZeroAddress();
        isApprovedPool[pool] = approved;
        emit PoolApprovalSet(pool, approved);
    }

    /// @notice Set pool-wide risk guardrails for traderId's pool — see
    /// RiskParams docs above for why this is per-trader, not per-follower.
    function setRiskParams(uint256 traderId, uint256 maxLossPerTrade, uint256 maxAllocationPct, bool pause)
        external
        onlyOwner
    {
        if (maxAllocationPct > 100) revert InvalidMaxAllocationPct();
        riskParams[traderId] = RiskParams(maxLossPerTrade, maxAllocationPct, pause);
        emit RiskParamsSet(traderId, maxLossPerTrade, maxAllocationPct, pause);
    }

    /// @notice Set the pool-wide stop-loss threshold for traderId's pool.
    function setStopLoss(uint256 traderId, uint256 pct) external onlyOwner {
        if (pct > 100) revert InvalidStopLossPct();
        stopLossPct[traderId] = pct;
        emit StopLossSet(traderId, pct);
    }

    /// @notice Wire up (or update) the ReferralRegistry address — see its
    /// doc comment for why this can't be an immutable constructor arg.
    function setReferralRegistry(address _referralRegistry) external onlyOwner {
        if (_referralRegistry == address(0)) revert ZeroAddress();
        referralRegistry = _referralRegistry;
        emit ReferralRegistrySet(_referralRegistry);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Followers
    // ─────────────────────────────────────────────────────────────────────

    /// @notice Deposit `amount` of collateralToken into `traderId`'s pool.
    /// Caller must already be following `traderId` in TraderRegistry.
    function deposit(uint256 traderId, uint256 amount) external nonReentrant returns (uint256 shares) {
        return _deposit(traderId, amount);
    }

    /// @notice Same as `deposit`, but if this is the caller's first-ever
    /// deposit (across any pool — see hasEverDeposited) and `referrer` is
    /// set, takes a REFERRAL_FEE_BPS (0.5%) fee out of `amount`, forwards it
    /// to ReferralRegistry, and credits `referrer`'s claimable earnings
    /// there. The fee comes out of the depositor's own principal — there is
    /// no other funding source for it — so the depositor's shares are
    /// minted against `amount - fee`, not the full `amount`. If it isn't
    /// the caller's first deposit, or referrer/referralRegistry is unset,
    /// this behaves exactly like a plain `deposit`.
    function depositWithReferral(uint256 traderId, uint256 amount, address referrer)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (referrer == msg.sender) revert SelfReferral();

        uint256 netAmount = amount;
        if (!hasEverDeposited[msg.sender] && referrer != address(0) && referralRegistry != address(0) && amount > 0)
        {
            uint256 fee = (amount * REFERRAL_FEE_BPS) / 10_000;
            if (fee > 0) {
                netAmount = amount - fee;
                collateralToken.safeTransferFrom(msg.sender, referralRegistry, fee);
                IReferralRegistry(referralRegistry).registerReferral(msg.sender, referrer, fee);
            }
        }

        return _deposit(traderId, netAmount);
    }

    function _deposit(uint256 traderId, uint256 amount) internal returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        _requireActiveTrader(traderId);
        if (!registry.isFollowing(traderId, msg.sender)) revert NotFollowingTrader();

        uint256 navBefore = poolNav(traderId);
        uint256 totalShares = totalSharesOf[traderId];
        shares = (totalShares == 0 || navBefore == 0) ? amount : (amount * totalShares) / navBefore;
        if (shares == 0) revert ZeroShares();

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        tokenBalance[traderId][address(collateralToken)] += amount;
        totalSharesOf[traderId] = totalShares + shares;
        sharesOf[traderId][msg.sender] += shares;
        hasEverDeposited[msg.sender] = true;

        emit Deposited(traderId, msg.sender, amount, shares);
    }

    /// @notice Record that the caller personally wants to pause copying for
    /// traderId. ADVISORY ONLY — see copyingPaused's doc comment for why
    /// this can't actually block trades. Requires currently following
    /// traderId, same precondition as setAllocations.
    function pauseCopying(uint256 traderId) external {
        if (!registry.isFollowing(traderId, msg.sender)) revert NotFollowingTrader();
        copyingPaused[msg.sender][traderId] = true;
        emit FollowerCopyingPaused(msg.sender, traderId);
    }

    function resumeCopying(uint256 traderId) external {
        copyingPaused[msg.sender][traderId] = false;
        emit FollowerCopyingResumed(msg.sender, traderId);
    }

    /// @notice Burn `shareAmount` of the caller's shares in `traderId`'s pool
    /// and withdraw the corresponding collateralToken. Only ever pays out of
    /// the pool's IDLE collateral — funds currently deployed in an open
    /// position on DreamDEX are not withdrawable until the indexer closes
    /// that position (see docs/LIMITATIONS.md).
    function withdraw(uint256 traderId, uint256 shareAmount) external nonReentrant returns (uint256 amount) {
        if (shareAmount == 0) revert ZeroAmount();

        uint256 followerShares = sharesOf[traderId][msg.sender];
        if (shareAmount > followerShares) revert InsufficientShares();

        uint256 totalShares = totalSharesOf[traderId];
        amount = (shareAmount * poolNav(traderId)) / totalShares;

        uint256 idle = tokenBalance[traderId][address(collateralToken)];
        if (amount > idle) revert InsufficientIdleBalance();

        sharesOf[traderId][msg.sender] = followerShares - shareAmount;
        totalSharesOf[traderId] = totalShares - shareAmount;
        tokenBalance[traderId][address(collateralToken)] = idle - amount;

        collateralToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(traderId, msg.sender, amount, shareAmount);
    }

    /// @notice Net asset value of `traderId`'s pool, denominated in
    /// collateralToken: idle collateral plus the tracked cost basis of
    /// whatever position is currently open. Not a mark-to-market price — see
    /// contract-level docs.
    function poolNav(uint256 traderId) public view returns (uint256) {
        return tokenBalance[traderId][address(collateralToken)] + deployedCostBasis[traderId];
    }

    /// @notice Declare how the caller wants their portfolio split across
    /// traders they follow, as whole percentages (0-100) summing to at most
    /// 100. Every traderId listed must already be followed by the caller
    /// (per TraderRegistry) — this does not follow traders itself; call
    /// TraderRegistry.follow/followMultiple first.
    ///
    /// This ONLY stores intent. It does not move any collateral: the
    /// frontend's "Rebalance" action reads the new split via
    /// getUserAllocations and issues the actual withdraw()/deposit() calls
    /// needed to match it, same as if the follower did that manually. Funds
    /// currently deployed in an open position aren't withdrawable until
    /// that position closes (see docs/LIMITATIONS.md), so a rebalance may
    /// only partially complete until then.
    function setAllocations(uint256[] calldata traderIds, uint256[] calldata allocationPcts) external {
        if (traderIds.length != allocationPcts.length) revert ArrayLengthMismatch();

        uint256 total;
        for (uint256 i = 0; i < traderIds.length; i++) {
            uint256 traderId = traderIds[i];
            if (!registry.isFollowing(traderId, msg.sender)) revert NotFollowingTrader();
            total += allocationPcts[i];
            allocationPctOf[msg.sender][traderId] = allocationPcts[i];
        }
        if (total > 100) revert AllocationExceeds100();

        emit AllocationsSet(msg.sender, traderIds, allocationPcts);
    }

    /// @notice Every trader `user` currently follows, and their declared
    /// allocation % for each (0 if never set via setAllocations). Loops
    /// registry.traderCount() — fine as a view call (no gas-limit exposure
    /// for eth_call), same pattern the frontend already uses client-side.
    function getUserAllocations(address user)
        external
        view
        returns (uint256[] memory traderIds, uint256[] memory allocationPcts)
    {
        uint256 count = registry.traderCount();
        uint256 matches;
        for (uint256 i = 1; i <= count; i++) {
            if (registry.isFollowing(i, user)) matches++;
        }

        traderIds = new uint256[](matches);
        allocationPcts = new uint256[](matches);
        uint256 j;
        for (uint256 i = 1; i <= count; i++) {
            if (registry.isFollowing(i, user)) {
                traderIds[j] = i;
                allocationPcts[j] = allocationPctOf[user][i];
                j++;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Executor
    // ─────────────────────────────────────────────────────────────────────

    /// @notice Mirror one fill of `traderId` by placing the equivalent order
    /// against `traderId`'s pooled collateral. `pool` must be allow-listed
    /// (see `setApprovedPool`). Sizing (`price`/`quantity`) is computed
    /// off-chain by the indexer (see indexer/src/executor.ts) — this
    /// function only enforces that the pool actually has the funds and that
    /// DreamDEX actually accepted the order.
    function executeCopy(
        uint256 traderId,
        address pool,
        bool isBid,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint96 builderFeeBpsTimes1k
    ) external onlyExecutor nonReentrant returns (uint128 orderId) {
        _requireActiveTrader(traderId);
        if (!isApprovedPool[pool]) revert PoolNotApproved();

        RiskParams memory rp = riskParams[traderId];
        if (rp.pauseCopying) revert CopyingPausedByRiskParams();

        IDreamDEXPool dex = IDreamDEXPool(pool);

        (address inputToken, uint256 requiredAmount,) =
            dex.getAutoPullRequirement(address(this), isBid, price, quantity, builderFeeBpsTimes1k);

        if (inputToken == DREAMDEX_NATIVE_SENTINEL) revert NativeSettlementNotSupported();

        (address baseToken, address quoteToken,,,,,) = dex.getPoolParams();
        address outputToken = isBid ? baseToken : quoteToken;
        if (isBid && inputToken != quoteToken) revert UnexpectedInputToken();
        if (!isBid && inputToken != baseToken) revert UnexpectedInputToken();

        // Risk cap: a BID may not deploy more than maxAllocationPct% of pool
        // NAV in one trade. Only applies to BIDs — inputToken is exactly
        // collateralToken here (checked above), directly comparable to
        // poolNav (also collateral-denominated). Not applied to SELLs:
        // closing part of a position returns capital to the pool rather
        // than committing more of it, so capping it would be
        // counter-protective, not protective.
        if (isBid && rp.maxAllocationPct > 0 && rp.maxAllocationPct < 100) {
            uint256 maxSpend = (poolNav(traderId) * rp.maxAllocationPct) / 100;
            if (requiredAmount > maxSpend) {
                if (maxSpend == 0) revert InsufficientPoolBalance();
                // Linear-scale quantity down to fit the cap — requiredAmount
                // includes a fixed taker-fee bps for a given price, so it
                // scales linearly with quantity — then re-fetch the exact
                // requiredAmount for the scaled trade rather than trust the
                // linear estimate, since DreamDEX's rounding at the margin
                // isn't guaranteed to match it exactly.
                quantity = (quantity * maxSpend) / requiredAmount;
                if (quantity == 0) revert InsufficientPoolBalance();
                (inputToken, requiredAmount,) =
                    dex.getAutoPullRequirement(address(this), isBid, price, quantity, builderFeeBpsTimes1k);
            }
        }

        if (tokenBalance[traderId][inputToken] < requiredAmount) revert InsufficientPoolBalance();

        uint256 inputBalBefore = IERC20(inputToken).balanceOf(address(this));
        uint256 outputBalBefore = IERC20(outputToken).balanceOf(address(this));

        IERC20(inputToken).forceApprove(pool, requiredAmount);

        bool success;
        (success, orderId) = dex.placeOrder(isBid, 0, price, quantity, expireTimestampNs, orderType, 0, address(0), 0);
        if (!success) revert OrderRejected();

        IERC20(inputToken).forceApprove(pool, 0);

        uint256 inputSpent = inputBalBefore - IERC20(inputToken).balanceOf(address(this));
        uint256 outputReceived = IERC20(outputToken).balanceOf(address(this)) - outputBalBefore;

        tokenBalance[traderId][inputToken] -= inputSpent;
        tokenBalance[traderId][outputToken] += outputReceived;

        if (isBid) {
            // Bought base with collateral: cost basis grows by what was spent.
            deployedCostBasis[traderId] += inputSpent;

            // No realized P&L on a BID (see docs/LIMITATIONS.md — no price
            // oracle to mark it), but it's still real volume: inputSpent is
            // exactly collateral-denominated here since inputToken ==
            // quoteToken == collateralToken is already enforced above.
            registry.recordPnL(traderId, 0, inputSpent);
        } else {
            // Sold base for collateral: release a proportional slice of cost
            // basis; the difference between that and outputReceived is
            // realized P&L, reflected automatically because outputReceived
            // already landed in idle collateral above.
            uint256 basisBefore = deployedCostBasis[traderId];
            uint256 baseHeldBefore = tokenBalance[traderId][baseToken] + inputSpent;
            uint256 basisReleased = baseHeldBefore == 0 ? 0 : (basisBefore * inputSpent) / baseHeldBefore;
            deployedCostBasis[traderId] = basisBefore - basisReleased;

            // "Won" is realized-P&L on THIS sell — the only point a BUY/SELL
            // pair has an actual outcome to judge, since this project has no
            // price oracle to mark a BUY's unrealized P&L (see
            // docs/LIMITATIONS.md). Feeds both the badge system
            // (TraderRegistry.recordTradeResult, below) and the loss checks.
            bool won = outputReceived >= basisReleased;

            if (!won) {
                uint256 realizedLoss = basisReleased - outputReceived;

                // Risk cap: revert the ENTIRE trade (including the
                // placeOrder above — this is atomic) if this sell's
                // realized loss alone exceeds maxLossPerTrade. Can only be
                // checked here, after the fill — realized loss depends on
                // outputReceived, which DreamDEX only reveals once the
                // order actually fills. Reverting post-fill still
                // guarantees no funds moved, same as a pre-trade check
                // would have.
                if (rp.maxLossPerTrade > 0 && realizedLoss > rp.maxLossPerTrade) revert MaxLossExceeded();

                // Stop-loss: accumulate into the pool's running realized
                // loss total, and once it exceeds stopLossPct% of the
                // pool's current NAV, flip riskParams.pauseCopying — see
                // stopLossPct's doc comment for why this is the "auto
                // circuit breaker" action instead of an "auto-unfollow".
                uint256 newCumulativeLoss = cumulativeLoss[traderId] + realizedLoss;
                cumulativeLoss[traderId] = newCumulativeLoss;
                uint256 stopPct = stopLossPct[traderId];
                if (stopPct > 0 && !riskParams[traderId].pauseCopying) {
                    uint256 stopThreshold = (poolNav(traderId) * stopPct) / 100;
                    if (newCumulativeLoss > stopThreshold) {
                        riskParams[traderId].pauseCopying = true;
                        emit StopLossTriggered(traderId, newCumulativeLoss);
                    }
                }
            }

            registry.recordTradeResult(traderId, won);

            // outputReceived and basisReleased are both collateral-token
            // amounts (outputToken == quoteToken == collateralToken for a
            // sell, enforced above) — the difference is exact realized
            // P&L, not an estimate. outputReceived is also exactly this
            // fill's collateral-denominated volume.
            int256 pnlDelta = int256(outputReceived) - int256(basisReleased);
            registry.recordPnL(traderId, pnlDelta, outputReceived);
        }

        emit CopyExecuted(traderId, pool, isBid, orderId, inputToken, inputSpent, outputToken, outputReceived);
    }

    function _requireActiveTrader(uint256 traderId) internal view {
        Trader memory t = registry.getTrader(traderId);
        if (!t.active) revert TraderInactive();
    }
}
