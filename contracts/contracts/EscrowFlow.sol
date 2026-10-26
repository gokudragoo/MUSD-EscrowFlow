// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EscrowFlow — milestone-based freelance escrow settled in MUSD
/// @notice One registry contract that holds many client/freelancer projects. Each project
///         locks the exact agreed MUSD budget and releases it milestone by milestone
///         according to rules both parties agreed to before funding.
/// @dev Design rules (see README "Escrow state machine"):
///      - The token is fixed at construction. There is no owner, no admin, no upgrade path,
///        no pause switch and no arbitrary external call: nobody can move escrowed funds
///        except through the per-project rules below.
///      - Terms (milestone amounts, deadlines, review periods, arbiter, flags and an
///        off-chain terms document hash) are editable by the client only before funding;
///        every edit bumps `termsVersion` and resets the freelancer's acceptance.
///      - Funding pulls the EXACT total and rejects any balance shortfall (fee-on-transfer).
///      - Every milestone pays out at most once: Released / Refunded / Resolved are terminal.
///      - Per project: fundedAmount == releasedAmount + refundedAmount + held.
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
        uint64 deadline;
        uint32 reviewPeriod;
        MilestoneStatus status;
        MilestoneStatus statusBeforeDispute;
        uint16 revision; // number of submissions so far
        uint64 submittedAt;
        uint64 changesRequestedAt;
        uint64 disputedAt;
        address disputeInitiator;
        address settlementProposer;
        uint128 proposedFreelancerAmount;
        bytes32 submissionHash; // keccak256 of the latest off-chain submission record
        uint128 releasedAmount; // paid to freelancer
        uint128 refundedAmount; // returned to client
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
    }

    // ---------------------------------------------------------------------
    // Constants & storage
    // ---------------------------------------------------------------------

    uint256 public constant MAX_MILESTONES = 20;
    /// @dev 60 s floor keeps the review-timeout path demonstrable on testnet; the app defaults to days.
    uint32 public constant MIN_REVIEW_PERIOD = 60;
    uint32 public constant MAX_REVIEW_PERIOD = 90 days;
    uint32 public constant MAX_RECLAIM_GRACE = 90 days;
    uint64 public constant MAX_DEADLINE_HORIZON = 5 * 365 days;

    /// @notice The settlement token (MUSD on Mezo). Immutable.
    IERC20 public immutable token;

    uint256 public projectCount;
    /// @notice Sum of funds currently held for all projects (excludes stray donations).
    uint256 public totalHeld;

    mapping(uint256 => Project) private _projects;
    mapping(uint256 => mapping(uint256 => Milestone)) private _milestones;
    mapping(address => uint256[]) private _clientProjects;
    mapping(address => uint256[]) private _freelancerProjects;
    mapping(uint256 => mapping(address => bool)) private _freelancerIndexed;

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
    event DisputeWithdrawn(uint256 indexed projectId, uint256 indexed index, address indexed by);
    event CancellationProposed(uint256 indexed projectId, address indexed by);
    event CancellationRevoked(uint256 indexed projectId, address indexed by);
    event ProjectCancelled(uint256 indexed projectId, address indexed by, uint128 refundedAmount, bool wasFunded);
    event ProjectClosed(uint256 indexed projectId, ProjectStatus finalStatus);

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

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
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
        projectId = ++projectCount;

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

    /// @notice Client reclaims a milestone whose deadline (+ grace) passed without a live submission.
    ///         Only available when deadline reclaim was agreed. Never touches submitted/disputed/paid work.
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
        m.status = MilestoneStatus.Refunded;
        m.refundedAmount = amount;
        p.refundedAmount += amount;
        totalHeld -= amount;
        _maybeClose(p, projectId);

        token.safeTransfer(p.client, amount);
        emit MilestoneRefunded(projectId, index, p.client, amount, RefundKind.DeadlineReclaim);
    }

    // ---------------------------------------------------------------------
    // Disputes
    // ---------------------------------------------------------------------

    /// @notice Either party freezes a milestone. Frozen funds move only via settlement,
    ///         arbiter ruling (if an arbiter was agreed), or the initiator withdrawing the dispute.
    function openDispute(uint256 projectId, uint256 index, bytes32 reasonHash) external {
        Project storage p = _project(projectId);
        _requireParty(p);
        _requireStatus(p, ProjectStatus.Active);
        Milestone storage m = _milestone(p, projectId, index);
        MilestoneStatus s = m.status;
        if (s != MilestoneStatus.Pending && s != MilestoneStatus.Submitted && s != MilestoneStatus.ChangesRequested) {
            revert InvalidMilestoneStatus(s);
        }
        // Once an agreed auto-release has vested, the client cannot block it with a dispute.
        if (
            msg.sender == p.client && s == MilestoneStatus.Submitted && p.autoRelease
                && block.timestamp >= uint256(m.submittedAt) + m.reviewPeriod
        ) revert ReviewWindowElapsed();

        m.statusBeforeDispute = s;
        m.status = MilestoneStatus.Disputed;
        m.disputeInitiator = msg.sender;
        m.disputedAt = uint64(block.timestamp);
        m.settlementProposer = address(0);
        m.proposedFreelancerAmount = 0;
        p.openDisputes += 1;
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

    /// @notice The dispute initiator withdraws it; the milestone returns to its prior state with
    ///         a fresh review window / grace period. Not available after a mutual cancellation.
    function withdrawDispute(uint256 projectId, uint256 index) external {
        Project storage p = _project(projectId);
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Disputed) revert InvalidMilestoneStatus(m.status);
        if (msg.sender != m.disputeInitiator) revert NotDisputeInitiator();
        if (p.cancelled) revert DisputeLockedByCancellation();

        MilestoneStatus restored = m.statusBeforeDispute;
        m.status = restored;
        if (restored == MilestoneStatus.Submitted) {
            m.submittedAt = uint64(block.timestamp);
        } else if (restored == MilestoneStatus.ChangesRequested) {
            m.changesRequestedAt = uint64(block.timestamp);
        }
        m.disputeInitiator = address(0);
        m.settlementProposer = address(0);
        m.proposedFreelancerAmount = 0;
        p.openDisputes -= 1;
        emit DisputeWithdrawn(projectId, index, msg.sender);
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
    function acceptCancellation(uint256 projectId) external nonReentrant {
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

        p.cancelled = true;
        p.cancelProposer = address(0);
        p.refundedAmount += refund;
        totalHeld -= refund;
        emit ProjectCancelled(projectId, msg.sender, refund, true);
        _maybeClose(p, projectId);

        if (refund > 0) token.safeTransfer(client, refund);
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
        // Interaction
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
        uint128 clientAmount = m.amount - freelancerAmount;
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
        totalHeld -= m.amount;
        _maybeClose(p, projectId);
        // Interactions
        if (freelancerAmount > 0) token.safeTransfer(freelancer, freelancerAmount);
        if (clientAmount > 0) token.safeTransfer(client, clientAmount);
        emit DisputeResolved(projectId, index, msg.sender, freelancerAmount, clientAmount, kind);
    }

    function _maybeClose(Project storage p, uint256 projectId) private {
        if (p.releasedAmount + p.refundedAmount == p.fundedAmount) {
            ProjectStatus finalStatus = p.cancelled ? ProjectStatus.Cancelled : ProjectStatus.Completed;
            p.status = finalStatus;
            p.cancelProposer = address(0);
            emit ProjectClosed(projectId, finalStatus);
        }
    }

    function _reclaimAvailableAt(Project storage p, Milestone storage m) private view returns (uint64) {
        uint64 availableAt = m.deadline + p.reclaimGracePeriod;
        if (m.status == MilestoneStatus.ChangesRequested) {
            uint64 afterChanges = m.changesRequestedAt + p.reclaimGracePeriod;
            if (afterChanges > availableAt) availableAt = afterChanges;
        }
        return availableAt;
    }

    function _validateParams(ProjectParams calldata params, address client) private view returns (uint128) {
        address freelancer = params.freelancer;
        address arbiter = params.arbiter;
        if (freelancer == address(0)) revert ZeroAddress();
        if (
            freelancer == client || freelancer == address(this) || freelancer == address(token)
                || arbiter == client || arbiter == freelancer || arbiter == address(this)
        ) revert InvalidParty();
        if (params.termsHash == bytes32(0)) revert EmptyTermsHash();

        uint256 n = params.amounts.length;
        if (n == 0 || n > MAX_MILESTONES) revert InvalidMilestoneCount();
        if (params.deadlines.length != n || params.reviewPeriods.length != n) revert LengthMismatch();
        if (params.reclaimGracePeriod > MAX_RECLAIM_GRACE) revert InvalidGracePeriod();

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

    function projectsOfClient(address client) external view returns (uint256[] memory) {
        return _clientProjects[client];
    }

    /// @dev May include projects whose freelancer was later changed pre-funding; check `freelancer`.
    function projectsOfFreelancer(address freelancer) external view returns (uint256[] memory) {
        return _freelancerProjects[freelancer];
    }

    /// @notice Timestamp after which the freelancer may claim (0 if not currently submitted).
    function reviewDeadline(uint256 projectId, uint256 index) external view returns (uint64) {
        Project storage p = _project(projectId);
        Milestone storage m = _milestone(p, projectId, index);
        if (m.status != MilestoneStatus.Submitted) return 0;
        return m.submittedAt + m.reviewPeriod;
    }

    /// @notice Timestamp after which the client may reclaim (0 if reclaim is not applicable).
    function reclaimAvailableAt(uint256 projectId, uint256 index) external view returns (uint64) {
        Project storage p = _project(projectId);
        Milestone storage m = _milestone(p, projectId, index);
        if (!p.deadlineReclaim) return 0;
        if (m.status != MilestoneStatus.Pending && m.status != MilestoneStatus.ChangesRequested) return 0;
        return _reclaimAvailableAt(p, m);
    }
}
