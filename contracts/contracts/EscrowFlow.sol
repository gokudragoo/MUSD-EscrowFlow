// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice The subset of Mezo's MUSDSavingsRate (sMUSD) vault that EscrowFlow uses.
/// @dev deposit pulls MUSD and mints sMUSD 1:1; withdraw burns sMUSD, first pays the caller's
///      accrued yield in MUSD and then returns exactly `amount` principal; claimYield pays the
///      accrued yield in MUSD. Yield per sMUSD is tracked in `yieldIndex` (scaled 1e18).
interface ISavingsVault {
    function musdToken() external view returns (address);
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimYield() external returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function claimableYield(address account) external view returns (uint256);
    function yieldIndex() external view returns (uint256);
    function supplyYieldIndex(address account) external view returns (uint256);
}

/// @title EscrowFlow (v2): milestone-based freelance escrow settled in MUSD
/// @notice One registry contract that holds many client/freelancer projects. Each project
///         locks the exact agreed MUSD budget and releases it milestone by milestone
///         according to rules both parties agreed to before funding. Optionally (agreed in the
///         terms) the held MUSD is parked in Mezo's sMUSD savings vault and the yield it earns
///         is split between the parties.
/// @dev Design rules (see README "Escrow state machine"):
///      - The token, the savings vault and the project-id offset are fixed at construction.
///        There is no owner, no admin, no upgrade path, no pause switch and no arbitrary
///        external call: nobody can move escrowed funds except through the per-project rules.
///      - Terms (milestone amounts, deadlines, review periods, arbiter, flags, yield split and an
///        off-chain terms document hash) are editable by the client only before funding;
///        every edit bumps `termsVersion` and resets the freelancer's acceptance.
///      - Funding pulls the EXACT total and rejects any balance shortfall (fee-on-transfer).
///      - Every milestone pays out at most once: Released / Refunded / Resolved are terminal.
///      - Per project: fundedAmount == releasedAmount + refundedAmount + held, and for
///        yield projects the vault principal equals held.
///      - Time spent disputed never runs a clock against either party: review windows,
///        change-request grace and deadline reclaim are shifted by the paused time.
contract EscrowFlow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum ProjectStatus {
        None, // 0: project does not exist
        AwaitingAcceptance, // created / edited, freelancer has not accepted the current version
        AwaitingFunding, // freelancer accepted the current version, client has not funded
        Active, // funded; milestones in progress
        Completed, // every milestone settled (released / refunded / resolved)
        Cancelled // cancelled before funding, or mutual cancellation executed and nothing held
    }

    enum MilestoneStatus {
        Pending, // not submitted yet (or funded & in progress)
        Submitted, // freelancer submitted work; client review window running
        ChangesRequested, // client asked for changes; freelancer may resubmit
        Disputed, // frozen until settlement, arbiter ruling or withdrawal
        Released, // paid to freelancer (terminal)
        Refunded, // returned to client (terminal)
        Resolved // dispute settled by split (terminal)
    }

    enum ReleaseKind {
        ClientApproval,
        ReviewTimeout
    }

    enum RefundKind {
        DeadlineReclaim,
        MutualCancellation
    }

    enum ResolutionKind {
        MutualSettlement,
        Arbiter
    }

    struct Project {
        address client;
        ProjectStatus status;
        bool autoRelease; // freelancer may claim after an unanswered review period
        bool deadlineReclaim; // client may reclaim a milestone past deadline + grace with no live submission
        bool cancelled; // a funded project's mutual cancellation was executed
        uint32 termsVersion; // starts at 1, bumped on each pre-funding edit
        uint32 reclaimGracePeriod; // seconds after a milestone deadline before reclaim is possible
        address freelancer;
        uint32 acceptedVersion; // terms version the freelancer accepted (0 = none)
        uint8 milestoneCount;
        uint8 openDisputes;
        address arbiter; // optional neutral third party agreed at creation (0 = none)
        uint64 createdAt;
        address cancelProposer; // party that proposed mutual cancellation (0 = none)
        uint64 fundedAt;
        bytes32 termsHash; // keccak256 of the canonical off-chain terms document
        uint128 totalAmount;
        uint128 fundedAmount;
        uint128 releasedAmount; // total paid to the freelancer
        uint128 refundedAmount; // total returned to the client
    }

    struct Milestone {
        uint128 amount;
        uint64 deadline; // agreed term; never mutated (effective deadline = deadline + pausedFor)
        uint32 reviewPeriod;
        MilestoneStatus status;
        MilestoneStatus statusBeforeDispute;
        uint16 revision; // number of submissions so far
        uint64 submittedAt; // shifted forward by withdrawn-dispute time
        uint64 changesRequestedAt; // shifted forward by withdrawn-dispute time
        uint64 disputedAt;
        address disputeInitiator;
        address settlementProposer;
        uint128 proposedFreelancerAmount;
        bytes32 submissionHash; // keccak256 of the latest off-chain submission record
        uint128 releasedAmount; // paid to freelancer
        uint128 refundedAmount; // returned to client
        uint64 pausedFor; // total seconds spent disputed (withdrawn disputes)
    }

    struct ProjectParams {
        address freelancer;
        address arbiter;
        bytes32 termsHash;
        bool autoRelease;
        bool deadlineReclaim;
        uint32 reclaimGracePeriod;
        uint128[] amounts;
        uint64[] deadlines;
        uint32[] reviewPeriods;
        bool yieldEnabled; // park held MUSD in the sMUSD savings vault
        uint16 freelancerYieldBps; // freelancer's share of the yield (0..10000); the client gets the rest
    }

    /// @dev Per-project savings state (kept apart from `Project` so its ABI is unchanged).
    struct YieldState {
        bool enabled;
        uint16 freelancerBps;
        uint128 principal; // MUSD of this project deposited in the vault (== held while funded)
        uint128 accrued; // checkpointed, undistributed yield attributed to this project
        uint128 paid; // yield already distributed to the parties
        uint256 snapshot; // accYieldPerPrincipal at the last checkpoint
    }

    struct YieldView {
        bool enabled;
        uint16 freelancerBps;
        uint128 principal;
        uint128 accrued; // checkpointed + this project's share of yield still pending in the vault
        uint128 paid;
    }

    // ---------------------------------------------------------------------
    // Constants & storage
    // ---------------------------------------------------------------------

    uint256 public constant MAX_MILESTONES = 20;
    /// @dev 60 s floor keeps the review-timeout path demonstrable on testnet; the app defaults to days.
    uint32 public constant MIN_REVIEW_PERIOD = 60;
    uint32 public constant MAX_REVIEW_PERIOD = 90 days;
    /// @dev Same testnet-demo floor as MIN_REVIEW_PERIOD; applies only when deadline reclaim is agreed.
    uint32 public constant MIN_RECLAIM_GRACE = 60;
    uint32 public constant MAX_RECLAIM_GRACE = 90 days;
    uint64 public constant MAX_DEADLINE_HORIZON = 5 * 365 days;
    uint256 private constant BPS = 10_000;
    uint256 private constant YIELD_PRECISION = 1e36;

    /// @notice The settlement token (MUSD on Mezo). Immutable.
    IERC20 public immutable token;
    /// @notice Mezo's sMUSD savings vault (address(0) = yield unavailable). Immutable.
    ISavingsVault public immutable savingsVault;
    /// @notice Project ids are ID_OFFSET + 1, ID_OFFSET + 2, ... (keeps ids unique across registries).
    uint256 public immutable ID_OFFSET;

    /// @notice Number of projects created (the latest id is ID_OFFSET + projectCount).
    uint256 public projectCount;
    /// @notice Sum of funds currently held for all projects (excludes stray donations).
    uint256 public totalHeld;
    /// @notice Sum of principal of all yield projects currently deposited in the savings vault.
    uint256 public totalYieldPrincipal;
    /// @notice Harvested yield per unit of yield principal, scaled by 1e36 (MasterChef-style).
    uint256 public accYieldPerPrincipal;
    /// @notice Yield harvested while no yield principal was deposited (belongs to no project).
    uint256 public unattributedYield;

    mapping(uint256 => Project) private _projects;
    mapping(uint256 => mapping(uint256 => Milestone)) private _milestones;
    mapping(address => uint256[]) private _clientProjects;
    mapping(address => uint256[]) private _freelancerProjects;
    mapping(uint256 => mapping(address => bool)) private _freelancerIndexed;
    mapping(uint256 => YieldState) private _yield;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ProjectCreated(uint256 indexed projectId, address indexed client, address indexed freelancer);
    event TermsSet(
        uint256 indexed projectId,
        uint32 version,
        bytes32 termsHash,
        address indexed freelancer,
        address arbiter,
        uint128 totalAmount,
        uint8 milestoneCount,
        bool autoRelease,
        bool deadlineReclaim,
        uint32 reclaimGracePeriod
    );
    event YieldTermsSet(uint256 indexed projectId, uint32 version, bool enabled, uint16 freelancerYieldBps);
    event TermsAccepted(uint256 indexed projectId, address indexed freelancer, uint32 version, bytes32 termsHash);
    event AcceptanceRevoked(uint256 indexed projectId, address indexed freelancer, uint32 version);
    event ProjectFunded(uint256 indexed projectId, address indexed client, uint128 amount);
    event MilestoneSubmitted(
        uint256 indexed projectId, uint256 indexed index, bytes32 submissionHash, uint16 revision, uint64 reviewDeadline
    );
    event ChangesRequested(uint256 indexed projectId, uint256 indexed index, bytes32 reasonHash, uint16 revision);
    event MilestoneReleased(
        uint256 indexed projectId, uint256 indexed index, address indexed freelancer, uint128 amount, ReleaseKind kind
    );
    event MilestoneRefunded(
        uint256 indexed projectId, uint256 indexed index, address indexed client, uint128 amount, RefundKind kind
    );
    event DisputeOpened(uint256 indexed projectId, uint256 indexed index, address indexed by, bytes32 reasonHash);
    event SettlementProposed(
        uint256 indexed projectId, uint256 indexed index, address indexed by, uint128 freelancerAmount
    );
    event DisputeResolved(
        uint256 indexed projectId,
        uint256 indexed index,
        address indexed resolver,
        uint128 freelancerAmount,
        uint128 clientAmount,
        ResolutionKind kind
    );
    event DisputeWithdrawn(uint256 indexed projectId, uint256 indexed index, address indexed by, uint64 pausedSeconds);
    event CancellationProposed(uint256 indexed projectId, address indexed by);
    event CancellationRevoked(uint256 indexed projectId, address indexed by);
    event ProjectCancelled(uint256 indexed projectId, address indexed by, uint128 refundedAmount, bool wasFunded);
    event ProjectClosed(uint256 indexed projectId, ProjectStatus finalStatus);
    event SavingsDeposited(uint256 indexed projectId, uint128 amount);
    event SavingsWithdrawn(uint256 indexed projectId, uint128 amount);
    event YieldHarvested(uint256 amount);
    event YieldDistributed(
        uint256 indexed projectId,
        address indexed freelancer,
        uint128 freelancerAmount,
        address indexed client,
        uint128 clientAmount
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error InvalidParty();
    error InvalidMilestoneCount();
    error LengthMismatch();
    error ZeroAmount(uint256 index);
    error AmountOverflow();
    error InvalidDeadline(uint256 index);
    error InvalidReviewPeriod(uint256 index);
    error InvalidGracePeriod();
    error EmptyTermsHash();
    error ProjectNotFound(uint256 projectId);
    error NotClient();
    error NotFreelancer();
    error NotParty();
    error NotArbiter();
    error NotDisputeInitiator();
    error InvalidProjectStatus(ProjectStatus current);
    error InvalidMilestoneStatus(MilestoneStatus current);
    error InvalidMilestoneIndex(uint256 index);
    error TermsMismatch();
    error DeadlinePassed(uint256 index);
    error FundingShortfall(uint256 expected, uint256 received);
    error EmptySubmission();
    error ReviewWindowElapsed();
    error ReviewWindowOpen(uint64 reviewDeadline);
    error AutoReleaseDisabled();
    error ReclaimDisabled();
    error ReclaimNotYetAvailable(uint64 availableAt);
    error NoSettlementProposal();
    error CannotAcceptOwnProposal();
    error SettlementMismatch(uint128 proposed);
    error SettlementExceedsAmount();
    error NoCancellationProposal();
    error ProjectAlreadyCancelled();
    error DisputeLockedByCancellation();
    error RefundMismatch(uint128 actual);
    error NothingSubmitted();
    error YieldUnavailable();
    error YieldNotEnabled();
    error InvalidYieldSplit();
    error VaultMismatch();
    error VaultShortfall();
    error NothingToDistribute();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @param token_ MUSD.
    /// @param vault_ Mezo's MUSDSavingsRate (sMUSD) vault for `token_`, or address(0) to disable yield.
    /// @param idOffset_ First project id is idOffset_ + 1.
    constructor(IERC20 token_, ISavingsVault vault_, uint256 idOffset_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        if (address(vault_) != address(0) && vault_.musdToken() != address(token_)) revert VaultMismatch();
        token = token_;
        savingsVault = vault_;
        ID_OFFSET = idOffset_;
    }

    // ---------------------------------------------------------------------
    // Modifiers / guards
    // ---------------------------------------------------------------------

    function _project(uint256 projectId) private view returns (Project storage p) {
        p = _projects[projectId];
        if (p.status == ProjectStatus.None) revert ProjectNotFound(projectId);
    }

    function _milestone(Project storage p, uint256 projectId, uint256 index)
        private
        view
        returns (Milestone storage m)
    {
        if (index >= p.milestoneCount) revert InvalidMilestoneIndex(index);
        m = _milestones[projectId][index];
    }

    function _requireClient(Project storage p) private view {
        if (msg.sender != p.client) revert NotClient();
    }

    function _requireFreelancer(Project storage p) private view {
        if (msg.sender != p.freelancer) revert NotFreelancer();
    }

    function _requireParty(Project storage p) private view {
        if (msg.sender != p.client && msg.sender != p.freelancer) revert NotParty();
    }

    function _requireStatus(Project storage p, ProjectStatus s) private view {
        if (p.status != s) revert InvalidProjectStatus(p.status);
    }

    // ---------------------------------------------------------------------
    // Agreement phase (no funds involved)
    // ---------------------------------------------------------------------

    /// @notice Client creates a project for a named freelancer. Nothing is funded yet.
    function createProject(ProjectParams calldata params) external returns (uint256 projectId) {
        uint128 total = _validateParams(params, msg.sender);
        projectId = ID_OFFSET + (++projectCount);

        Project storage p = _projects[projectId];
        p.client = msg.sender;
        p.status = ProjectStatus.AwaitingAcceptance;
        p.createdAt = uint64(block.timestamp);
        _writeTerms(p, projectId, params, total, 1);

        _clientProjects[msg.sender].push(projectId);
        _indexFreelancer(projectId, params.freelancer);

        emit ProjectCreated(projectId, msg.sender, params.freelancer);
        _emitTermsSet(projectId, p);
    }

    /// @notice Client edits terms before funding. Resets the freelancer's acceptance.
    function updateTerms(uint256 projectId, ProjectParams calldata params) external {
        Project storage p = _project(projectId);
        _requireClient(p);
        if (p.status != ProjectStatus.AwaitingAcceptance && p.status != ProjectStatus.AwaitingFunding) {
            revert InvalidProjectStatus(p.status);
        }
        uint128 total = _validateParams(params, msg.sender);

        uint256 oldCount = p.milestoneCount;
        uint256 newCount = params.amounts.length;
        for (uint256 i = newCount; i < oldCount; ++i) {
            delete _milestones[projectId][i];
        }

        p.status = ProjectStatus.AwaitingAcceptance;
        p.acceptedVersion = 0;
        _writeTerms(p, projectId, params, total, p.termsVersion + 1);
        _indexFreelancer(projectId, params.freelancer);

        _emitTermsSet(projectId, p);
    }

    /// @notice Named freelancer accepts the exact current terms (hash + version must match).
    function acceptTerms(uint256 projectId, bytes32 termsHash, uint32 version) external {
        Project storage p = _project(projectId);
        _requireFreelancer(p);
        _requireStatus(p, ProjectStatus.AwaitingAcceptance);
        if (termsHash != p.termsHash || version != p.termsVersion) revert TermsMismatch();

        p.acceptedVersion = version;
        p.status = ProjectStatus.AwaitingFunding;
        emit TermsAccepted(projectId, msg.sender, version, termsHash);
    }

    /// @notice Freelancer withdraws acceptance before the client funds.
    function revokeAcceptance(uint256 projectId) external {
        Project storage p = _project(projectId);
        _requireFreelancer(p);
        _requireStatus(p, ProjectStatus.AwaitingFunding);

        uint32 version = p.acceptedVersion;
        p.acceptedVersion = 0;
        p.status = ProjectStatus.AwaitingAcceptance;
        emit AcceptanceRevoked(projectId, msg.sender, version);
    }

    /// @notice Client cancels an unfunded project. No funds move.
    function cancelUnfunded(uint256 projectId) external {
        Project storage p = _project(projectId);
        _requireClient(p);
        if (p.status != ProjectStatus.AwaitingAcceptance && p.status != ProjectStatus.AwaitingFunding) {
            revert InvalidProjectStatus(p.status);
        }
        p.status = ProjectStatus.Cancelled;
        p.acceptedVersion = 0;
        emit ProjectCancelled(projectId, msg.sender, 0, false);
        emit ProjectClosed(projectId, ProjectStatus.Cancelled);
    }

    // ---------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------

    /// @notice Client deposits the exact total (requires prior `approve`).
    function fund(uint256 projectId) external nonReentrant {
        _fund(projectId);
    }

    /// @notice Client deposits the exact total using an EIP-2612 permit signature (single tx).
    /// @dev The permit call is wrapped in try/catch so a front-run permit cannot grief funding;
    ///      the subsequent transferFrom still requires sufficient allowance.
    function fundWithPermit(uint256 projectId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        Project storage p = _project(projectId);
        try IERC20Permit(address(token)).permit(msg.sender, address(this), p.totalAmount, deadline, v, r, s) {}
            catch {}
        _fund(projectId);
    }

    function _fund(uint256 projectId) private {
        Project storage p = _project(projectId);
        _requireClient(p);
        _requireStatus(p, ProjectStatus.AwaitingFunding);
        // Defensive: AwaitingFunding implies acceptance of the current version.
        if (p.acceptedVersion != p.termsVersion) revert TermsMismatch();

        uint256 count = p.milestoneCount;
        for (uint256 i = 0; i < count; ++i) {
            if (_milestones[projectId][i].deadline <= block.timestamp) revert DeadlinePassed(i);
        }

        uint128 total = p.totalAmount;
        // Effects
        p.status = ProjectStatus.Active;
        p.fundedAt = uint64(block.timestamp);
        p.fundedAmount = total;
        totalHeld += total;

        // Interaction + exact-amount verification
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), total);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != total) revert FundingShortfall(total, received);

        emit ProjectFunded(projectId, msg.sender, total);

        YieldState storage y = _yield[projectId];
        if (y.enabled) _vaultIn(projectId, y, total);
    }

    // ---------------------------------------------------------------------
    // Work & review
    // ---------------------------------------------------------------------

    /// @notice Freelancer submits (or resubmits) a milestone. `submissionHash` commits to the
    ///         off-chain submission record (description, links, attachment digests).
    function submitMilestone(uint256 projectId, uint256 index, bytes32 submissionHash) external {
        Project storage p = _project(projectId);
        _requireFreelancer(p);
        _requireStatus(p, ProjectStatus.Active);
        if (p.cancelled) revert ProjectAlreadyCancelled();
        if (submissionHash == bytes32(0)) revert EmptySubmission();
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.ChangesRequested) {
            revert InvalidMilestoneStatus(m.status);
        }

        m.status = MilestoneStatus.Submitted;
        m.submittedAt = uint64(block.timestamp);
        m.submissionHash = submissionHash;
        unchecked {
            m.revision += 1;
        }

        // New work invalidates any pending cancellation proposal so it cannot sweep fresh work.
        if (p.cancelProposer != address(0)) {
            address proposer = p.cancelProposer;
            p.cancelProposer = address(0);
            emit CancellationRevoked(projectId, proposer);
        }

        emit MilestoneSubmitted(projectId, index, submissionHash, m.revision, m.submittedAt + m.reviewPeriod);
    }

    /// @notice Client requests changes on a submitted milestone.
    /// @dev When auto-release is part of the terms, this is only possible inside the review window.
    function requestChanges(uint256 projectId, uint256 index, bytes32 reasonHash) external {
        Project storage p = _project(projectId);
        _requireClient(p);
        _requireStatus(p, ProjectStatus.Active);
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Submitted) revert InvalidMilestoneStatus(m.status);
        if (p.autoRelease && block.timestamp >= uint256(m.submittedAt) + m.reviewPeriod) {
            revert ReviewWindowElapsed();
        }

        m.status = MilestoneStatus.ChangesRequested;
        m.changesRequestedAt = uint64(block.timestamp);
        emit ChangesRequested(projectId, index, reasonHash, m.revision);
    }

    /// @notice Client approves submitted work and releases that milestone's MUSD to the freelancer.
    function approveAndRelease(uint256 projectId, uint256 index) external nonReentrant {
        Project storage p = _project(projectId);
        _requireClient(p);
        _requireStatus(p, ProjectStatus.Active);
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Submitted && m.status != MilestoneStatus.ChangesRequested) {
            revert InvalidMilestoneStatus(m.status);
        }
        _release(p, m, projectId, index, ReleaseKind.ClientApproval);
    }

    /// @notice Freelancer claims a submitted milestone after the review period elapsed with no
    ///         change request or dispute. Only available when auto-release was agreed.
    function claimAfterReviewTimeout(uint256 projectId, uint256 index) external nonReentrant {
        Project storage p = _project(projectId);
        _requireFreelancer(p);
        _requireStatus(p, ProjectStatus.Active);
        if (!p.autoRelease) revert AutoReleaseDisabled();
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Submitted) revert InvalidMilestoneStatus(m.status);
        uint64 dueAt = m.submittedAt + m.reviewPeriod;
        if (block.timestamp < dueAt) revert ReviewWindowOpen(dueAt);
        _release(p, m, projectId, index, ReleaseKind.ReviewTimeout);
    }

    /// @notice Client reclaims a milestone whose deadline (+ dispute pauses + grace) passed without a
    ///         live submission. Only available when deadline reclaim was agreed. Never touches
    ///         submitted/disputed/paid work.
    function reclaimExpiredMilestone(uint256 projectId, uint256 index) external nonReentrant {
        Project storage p = _project(projectId);
        _requireClient(p);
        _requireStatus(p, ProjectStatus.Active);
        if (!p.deadlineReclaim) revert ReclaimDisabled();
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.ChangesRequested) {
            revert InvalidMilestoneStatus(m.status);
        }
        uint64 availableAt = _reclaimAvailableAt(p, m);
        if (block.timestamp <= availableAt) revert ReclaimNotYetAvailable(availableAt);

        uint128 amount = m.amount;
        address client = p.client;
        m.status = MilestoneStatus.Refunded;
        m.refundedAmount = amount;
        p.refundedAmount += amount;
        totalHeld -= amount;
        _maybeClose(p, projectId);

        if (_yield[projectId].enabled) _vaultOut(projectId, amount);
        token.safeTransfer(client, amount);
        emit MilestoneRefunded(projectId, index, client, amount, RefundKind.DeadlineReclaim);
    }

    // ---------------------------------------------------------------------
    // Disputes
    // ---------------------------------------------------------------------

    /// @notice Either party freezes a milestone. Frozen funds move only via settlement,
    ///         arbiter ruling (if an arbiter was agreed), or the initiator withdrawing the dispute.
    ///         The freelancer can only dispute work they actually submitted. Opening a dispute
    ///         withdraws any pending cancellation proposal (the refundable set changed).
    function openDispute(uint256 projectId, uint256 index, bytes32 reasonHash) external {
        Project storage p = _project(projectId);
        _requireParty(p);
        _requireStatus(p, ProjectStatus.Active);
        Milestone storage m = _milestone(p, projectId, index);
        MilestoneStatus s = m.status;
        if (s != MilestoneStatus.Pending && s != MilestoneStatus.Submitted && s != MilestoneStatus.ChangesRequested) {
            revert InvalidMilestoneStatus(s);
        }
        if (msg.sender == p.client) {
            // Once an agreed auto-release has vested, the client cannot block it with a dispute.
            if (
                s == MilestoneStatus.Submitted && p.autoRelease
                    && block.timestamp >= uint256(m.submittedAt) + m.reviewPeriod
            ) revert ReviewWindowElapsed();
        } else if (m.revision == 0) {
            revert NothingSubmitted();
        }

        m.statusBeforeDispute = s;
        m.status = MilestoneStatus.Disputed;
        m.disputeInitiator = msg.sender;
        m.disputedAt = uint64(block.timestamp);
        m.settlementProposer = address(0);
        m.proposedFreelancerAmount = 0;
        p.openDisputes += 1;
        _clearCancelProposal(p, projectId);
        emit DisputeOpened(projectId, index, msg.sender, reasonHash);
    }

    /// @notice Either party proposes (or counter-proposes) how much of the disputed milestone
    ///         goes to the freelancer; the remainder returns to the client.
    function proposeSettlement(uint256 projectId, uint256 index, uint128 freelancerAmount) external {
        Project storage p = _project(projectId);
        _requireParty(p);
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Disputed) revert InvalidMilestoneStatus(m.status);
        if (freelancerAmount > m.amount) revert SettlementExceedsAmount();

        m.settlementProposer = msg.sender;
        m.proposedFreelancerAmount = freelancerAmount;
        emit SettlementProposed(projectId, index, msg.sender, freelancerAmount);
    }

    /// @notice The counterparty accepts the exact standing proposal and the split is paid out.
    function acceptSettlement(uint256 projectId, uint256 index, uint128 freelancerAmount) external nonReentrant {
        Project storage p = _project(projectId);
        _requireParty(p);
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Disputed) revert InvalidMilestoneStatus(m.status);
        if (m.settlementProposer == address(0)) revert NoSettlementProposal();
        if (m.settlementProposer == msg.sender) revert CannotAcceptOwnProposal();
        if (m.proposedFreelancerAmount != freelancerAmount) revert SettlementMismatch(m.proposedFreelancerAmount);

        _resolve(p, m, projectId, index, freelancerAmount, ResolutionKind.MutualSettlement);
    }

    /// @notice The arbiter agreed in the terms rules on a disputed milestone.
    function arbiterResolve(uint256 projectId, uint256 index, uint128 freelancerAmount) external nonReentrant {
        Project storage p = _project(projectId);
        if (p.arbiter == address(0) || msg.sender != p.arbiter) revert NotArbiter();
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Disputed) revert InvalidMilestoneStatus(m.status);
        if (freelancerAmount > m.amount) revert SettlementExceedsAmount();

        _resolve(p, m, projectId, index, freelancerAmount, ResolutionKind.Arbiter);
    }

    /// @notice The dispute initiator withdraws it; the milestone returns to its prior state and
    ///         every clock resumes where it paused: the review window / change-request grace are
    ///         shifted by the disputed time and the reclaim deadline is extended by it. Withdraws
    ///         any pending cancellation proposal. Not available after a mutual cancellation.
    function withdrawDispute(uint256 projectId, uint256 index) external {
        Project storage p = _project(projectId);
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Disputed) revert InvalidMilestoneStatus(m.status);
        if (msg.sender != m.disputeInitiator) revert NotDisputeInitiator();
        if (p.cancelled) revert DisputeLockedByCancellation();

        uint64 paused = uint64(block.timestamp) - m.disputedAt;
        m.pausedFor += paused;
        MilestoneStatus restored = m.statusBeforeDispute;
        m.status = restored;
        if (restored == MilestoneStatus.Submitted) {
            m.submittedAt += paused;
        } else if (restored == MilestoneStatus.ChangesRequested) {
            m.changesRequestedAt += paused;
        }
        m.disputeInitiator = address(0);
        m.settlementProposer = address(0);
        m.proposedFreelancerAmount = 0;
        p.openDisputes -= 1;
        _clearCancelProposal(p, projectId);
        emit DisputeWithdrawn(projectId, index, msg.sender, paused);
    }

    // ---------------------------------------------------------------------
    // Mutual cancellation of a funded project
    // ---------------------------------------------------------------------

    function proposeCancellation(uint256 projectId) external {
        Project storage p = _project(projectId);
        _requireParty(p);
        _requireStatus(p, ProjectStatus.Active);
        if (p.cancelled) revert ProjectAlreadyCancelled();
        p.cancelProposer = msg.sender;
        emit CancellationProposed(projectId, msg.sender);
    }

    function revokeCancellation(uint256 projectId) external {
        Project storage p = _project(projectId);
        if (p.cancelProposer == address(0)) revert NoCancellationProposal();
        if (msg.sender != p.cancelProposer) revert NotParty();
        p.cancelProposer = address(0);
        emit CancellationRevoked(projectId, msg.sender);
    }

    /// @notice Counterparty accepts cancellation: every unpaid, undisputed milestone
    ///         (Pending / Submitted / ChangesRequested) is refunded to the client. Released and
    ///         resolved funds are untouched; disputed milestones stay frozen until resolved.
    /// @param expectedRefund The refund the caller agreed to; reverts RefundMismatch(actual) otherwise.
    function acceptCancellation(uint256 projectId, uint128 expectedRefund) external nonReentrant {
        Project storage p = _project(projectId);
        _requireParty(p);
        _requireStatus(p, ProjectStatus.Active);
        if (p.cancelled) revert ProjectAlreadyCancelled();
        if (p.cancelProposer == address(0)) revert NoCancellationProposal();
        if (p.cancelProposer == msg.sender) revert CannotAcceptOwnProposal();

        address client = p.client;
        uint128 refund;
        uint256 count = p.milestoneCount;
        for (uint256 i = 0; i < count; ++i) {
            Milestone storage m = _milestones[projectId][i];
            MilestoneStatus s = m.status;
            if (s == MilestoneStatus.Pending || s == MilestoneStatus.Submitted || s == MilestoneStatus.ChangesRequested) {
                uint128 amount = m.amount;
                m.status = MilestoneStatus.Refunded;
                m.refundedAmount = amount;
                refund += amount;
                emit MilestoneRefunded(projectId, i, client, amount, RefundKind.MutualCancellation);
            }
        }
        if (refund != expectedRefund) revert RefundMismatch(refund);

        p.cancelled = true;
        p.cancelProposer = address(0);
        p.refundedAmount += refund;
        totalHeld -= refund;
        emit ProjectCancelled(projectId, msg.sender, refund, true);
        _maybeClose(p, projectId);

        if (refund > 0) {
            if (_yield[projectId].enabled) _vaultOut(projectId, refund);
            token.safeTransfer(client, refund);
        }
    }

    // ---------------------------------------------------------------------
    // Savings yield
    // ---------------------------------------------------------------------

    /// @notice Pays this project's accrued savings yield to the parties using the agreed split
    ///         (freelancerYieldBps to the freelancer, the rest to the client). Callable by either
    ///         party in any project status, including after completion or cancellation.
    function distributeYield(uint256 projectId) external nonReentrant {
        Project storage p = _project(projectId);
        _requireParty(p);
        YieldState storage y = _yield[projectId];
        if (!y.enabled) revert YieldNotEnabled();

        _harvest();
        _checkpoint(y);
        uint128 amount = y.accrued;
        if (amount == 0) revert NothingToDistribute();
        y.accrued = 0;
        y.paid += amount;

        uint128 freelancerAmount = uint128((uint256(amount) * y.freelancerBps) / BPS);
        uint128 clientAmount = amount - freelancerAmount;
        address freelancer = p.freelancer;
        address client = p.client;
        if (freelancerAmount > 0) token.safeTransfer(freelancer, freelancerAmount);
        if (clientAmount > 0) token.safeTransfer(client, clientAmount);
        emit YieldDistributed(projectId, freelancer, freelancerAmount, client, clientAmount);
    }

    /// @dev Deposits a yield project's funded total into the vault. Yield that the vault credits
    ///      during the deposit (protocol / strategy distribution) accrues to the escrow's
    ///      PRE-deposit balance, so it is harvested before this project's principal is counted:
    ///      a project never shares yield earned before it was funded.
    function _vaultIn(uint256 projectId, YieldState storage y, uint128 amount) private {
        ISavingsVault vault = savingsVault;
        uint256 tokenBefore = token.balanceOf(address(this));
        uint256 sharesBefore = vault.balanceOf(address(this));
        token.forceApprove(address(vault), amount);
        vault.deposit(amount);
        if (
            token.balanceOf(address(this)) + amount != tokenBefore
                || vault.balanceOf(address(this)) != sharesBefore + amount
        ) revert VaultMismatch();

        _harvest();
        _checkpoint(y);
        y.principal += amount;
        totalYieldPrincipal += amount;
        emit SavingsDeposited(projectId, amount);
    }

    /// @dev Withdraws `amount` principal of a yield project from the vault. The vault pays the
    ///      escrow's accrued yield first; it is credited while this principal is still counted.
    function _vaultOut(uint256 projectId, uint128 amount) private {
        YieldState storage y = _yield[projectId];
        uint256 before = token.balanceOf(address(this));
        savingsVault.withdraw(amount);
        uint256 got = token.balanceOf(address(this)) - before;
        if (got < amount) revert VaultShortfall();
        _creditYield(got - amount);
        _checkpoint(y);
        y.principal -= amount;
        totalYieldPrincipal -= amount;
        emit SavingsWithdrawn(projectId, amount);
    }

    function _harvest() private {
        uint256 before = token.balanceOf(address(this));
        savingsVault.claimYield();
        _creditYield(token.balanceOf(address(this)) - before);
    }

    function _creditYield(uint256 amount) private {
        if (amount == 0) return;
        uint256 principal = totalYieldPrincipal;
        if (principal == 0) unattributedYield += amount;
        else accYieldPerPrincipal += (amount * YIELD_PRECISION) / principal;
        emit YieldHarvested(amount);
    }

    function _checkpoint(YieldState storage y) private {
        uint256 acc = accYieldPerPrincipal;
        uint256 principal = y.principal;
        if (principal > 0) y.accrued += SafeCast.toUint128((principal * (acc - y.snapshot)) / YIELD_PRECISION);
        y.snapshot = acc;
    }

    // ---------------------------------------------------------------------
    // Internal settlement helpers
    // ---------------------------------------------------------------------

    function _release(Project storage p, Milestone storage m, uint256 projectId, uint256 index, ReleaseKind kind)
        private
    {
        uint128 amount = m.amount;
        address freelancer = p.freelancer;
        // Effects
        m.status = MilestoneStatus.Released;
        m.releasedAmount = amount;
        p.releasedAmount += amount;
        totalHeld -= amount;
        _maybeClose(p, projectId);
        // Interactions
        if (_yield[projectId].enabled) _vaultOut(projectId, amount);
        token.safeTransfer(freelancer, amount);
        emit MilestoneReleased(projectId, index, freelancer, amount, kind);
    }

    function _resolve(
        Project storage p,
        Milestone storage m,
        uint256 projectId,
        uint256 index,
        uint128 freelancerAmount,
        ResolutionKind kind
    ) private {
        uint128 amount = m.amount;
        uint128 clientAmount = amount - freelancerAmount;
        address freelancer = p.freelancer;
        address client = p.client;
        // Effects
        m.status = MilestoneStatus.Resolved;
        m.releasedAmount = freelancerAmount;
        m.refundedAmount = clientAmount;
        m.settlementProposer = address(0);
        m.proposedFreelancerAmount = 0;
        p.releasedAmount += freelancerAmount;
        p.refundedAmount += clientAmount;
        p.openDisputes -= 1;
        totalHeld -= amount;
        _maybeClose(p, projectId);
        // Interactions
        if (_yield[projectId].enabled) _vaultOut(projectId, amount);
        if (freelancerAmount > 0) token.safeTransfer(freelancer, freelancerAmount);
        if (clientAmount > 0) token.safeTransfer(client, clientAmount);
        emit DisputeResolved(projectId, index, msg.sender, freelancerAmount, clientAmount, kind);
    }

    function _maybeClose(Project storage p, uint256 projectId) private {
        if (p.releasedAmount + p.refundedAmount == p.fundedAmount) {
            ProjectStatus finalStatus = p.cancelled ? ProjectStatus.Cancelled : ProjectStatus.Completed;
            p.status = finalStatus;
            _clearCancelProposal(p, projectId);
            emit ProjectClosed(projectId, finalStatus);
        }
    }

    function _clearCancelProposal(Project storage p, uint256 projectId) private {
        if (p.cancelProposer != address(0)) {
            p.cancelProposer = address(0);
            emit CancellationRevoked(projectId, msg.sender);
        }
    }

    function _reclaimAvailableAt(Project storage p, Milestone storage m) private view returns (uint64) {
        uint64 availableAt = m.deadline + m.pausedFor + p.reclaimGracePeriod;
        if (m.status == MilestoneStatus.ChangesRequested) {
            uint64 afterChanges = m.changesRequestedAt + p.reclaimGracePeriod;
            if (afterChanges > availableAt) availableAt = afterChanges;
        }
        return availableAt;
    }

    function _validateParams(ProjectParams calldata params, address client) private view returns (uint128) {
        address freelancer = params.freelancer;
        address arbiter = params.arbiter;
        address vault = address(savingsVault);
        if (freelancer == address(0)) revert ZeroAddress();
        if (
            freelancer == client || freelancer == address(this) || freelancer == address(token)
                || arbiter == client || arbiter == freelancer || arbiter == address(this) || arbiter == address(token)
                || (arbiter == vault && vault != address(0))
        ) revert InvalidParty();
        if (params.termsHash == bytes32(0)) revert EmptyTermsHash();

        uint256 n = params.amounts.length;
        if (n == 0 || n > MAX_MILESTONES) revert InvalidMilestoneCount();
        if (params.deadlines.length != n || params.reviewPeriods.length != n) revert LengthMismatch();
        uint32 grace = params.reclaimGracePeriod;
        if (grace > MAX_RECLAIM_GRACE || (params.deadlineReclaim && grace < MIN_RECLAIM_GRACE)) {
            revert InvalidGracePeriod();
        }
        if (params.yieldEnabled) {
            if (vault == address(0)) revert YieldUnavailable();
            if (params.freelancerYieldBps > BPS) revert InvalidYieldSplit();
        } else if (params.freelancerYieldBps != 0) {
            revert InvalidYieldSplit();
        }

        uint256 total;
        uint256 horizon = block.timestamp + MAX_DEADLINE_HORIZON;
        for (uint256 i = 0; i < n; ++i) {
            uint128 amount = params.amounts[i];
            if (amount == 0) revert ZeroAmount(i);
            total += amount;
            uint64 deadline = params.deadlines[i];
            if (deadline <= block.timestamp || deadline > horizon) revert InvalidDeadline(i);
            uint32 rp = params.reviewPeriods[i];
            if (rp < MIN_REVIEW_PERIOD || rp > MAX_REVIEW_PERIOD) revert InvalidReviewPeriod(i);
        }
        if (total > type(uint128).max) revert AmountOverflow();
        return uint128(total);
    }

    function _writeTerms(
        Project storage p,
        uint256 projectId,
        ProjectParams calldata params,
        uint128 total,
        uint32 version
    ) private {
        p.freelancer = params.freelancer;
        p.arbiter = params.arbiter;
        p.termsHash = params.termsHash;
        p.autoRelease = params.autoRelease;
        p.deadlineReclaim = params.deadlineReclaim;
        p.reclaimGracePeriod = params.reclaimGracePeriod;
        p.totalAmount = total;
        p.termsVersion = version;
        uint256 n = params.amounts.length;
        p.milestoneCount = uint8(n);
        for (uint256 i = 0; i < n; ++i) {
            Milestone storage m = _milestones[projectId][i];
            m.amount = params.amounts[i];
            m.deadline = params.deadlines[i];
            m.reviewPeriod = params.reviewPeriods[i];
        }
        YieldState storage y = _yield[projectId];
        y.enabled = params.yieldEnabled;
        y.freelancerBps = params.freelancerYieldBps;
    }

    function _indexFreelancer(uint256 projectId, address freelancer) private {
        if (!_freelancerIndexed[projectId][freelancer]) {
            _freelancerIndexed[projectId][freelancer] = true;
            _freelancerProjects[freelancer].push(projectId);
        }
    }

    function _emitTermsSet(uint256 projectId, Project storage p) private {
        emit TermsSet(
            projectId,
            p.termsVersion,
            p.termsHash,
            p.freelancer,
            p.arbiter,
            p.totalAmount,
            p.milestoneCount,
            p.autoRelease,
            p.deadlineReclaim,
            p.reclaimGracePeriod
        );
        YieldState storage y = _yield[projectId];
        emit YieldTermsSet(projectId, p.termsVersion, y.enabled, y.freelancerBps);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getProject(uint256 projectId) external view returns (Project memory) {
        return _project(projectId);
    }

    function getMilestone(uint256 projectId, uint256 index) external view returns (Milestone memory) {
        Project storage p = _project(projectId);
        return _milestone(p, projectId, index);
    }

    function getMilestones(uint256 projectId) external view returns (Milestone[] memory list) {
        Project storage p = _project(projectId);
        uint256 n = p.milestoneCount;
        list = new Milestone[](n);
        for (uint256 i = 0; i < n; ++i) {
            list[i] = _milestones[projectId][i];
        }
    }

    /// @notice Funds currently held for a project: funded − released − refunded.
    function heldAmount(uint256 projectId) public view returns (uint128) {
        Project storage p = _project(projectId);
        return p.fundedAmount - p.releasedAmount - p.refundedAmount;
    }

    /// @notice Savings terms and yield accounting of a project. `accrued` is an estimate that
    ///         includes this project's share of yield the vault has credited but the escrow has
    ///         not harvested yet; distributeYield pays at least that much.
    function getYield(uint256 projectId) external view returns (YieldView memory v) {
        _project(projectId);
        YieldState storage y = _yield[projectId];
        v.enabled = y.enabled;
        v.freelancerBps = y.freelancerBps;
        v.principal = y.principal;
        v.paid = y.paid;
        uint256 accrued = y.accrued;
        if (y.principal > 0) {
            ISavingsVault vault = savingsVault;
            uint256 pending = vault.claimableYield(address(this))
                + (vault.balanceOf(address(this)) * (vault.yieldIndex() - vault.supplyYieldIndex(address(this)))) / 1e18;
            uint256 acc = accYieldPerPrincipal + (pending * YIELD_PRECISION) / totalYieldPrincipal;
            accrued += (uint256(y.principal) * (acc - y.snapshot)) / YIELD_PRECISION;
        }
        v.accrued = SafeCast.toUint128(accrued);
    }

    function projectsOfClient(address client) external view returns (uint256[] memory) {
        return _clientProjects[client];
    }

    /// @dev May include projects whose freelancer was later changed pre-funding; check `freelancer`.
    function projectsOfFreelancer(address freelancer) external view returns (uint256[] memory) {
        return _freelancerProjects[freelancer];
    }

    /// @notice Timestamp after which the freelancer may claim (0 if not currently submitted).
    ///         Already shifted by any withdrawn-dispute pause.
    function reviewDeadline(uint256 projectId, uint256 index) external view returns (uint64) {
        Project storage p = _project(projectId);
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Submitted) return 0;
        return m.submittedAt + m.reviewPeriod;
    }

    /// @notice Timestamp after which the client may reclaim (0 if reclaim is not applicable).
    ///         Includes the milestone's dispute pauses (deadline + pausedFor + grace).
    function reclaimAvailableAt(uint256 projectId, uint256 index) external view returns (uint64) {
        Project storage p = _project(projectId);
        Milestone storage m = _milestone(p, projectId, index);
        if (!p.deadlineReclaim) return 0;
        if (m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.ChangesRequested) return 0;
        return _reclaimAvailableAt(p, m);
    }
}
