/**
 * Client/server mirror of the EscrowFlow state machine. The contract is the authority; these
 * helpers only decide what to SHOW and which actions to OFFER (the contract re-checks all of it).
 */
import type { Address, Hex } from "viem";

export const ProjectStatus = {
  None: 0,
  AwaitingAcceptance: 1,
  AwaitingFunding: 2,
  Active: 3,
  Completed: 4,
  Cancelled: 5,
} as const;
export type ProjectStatusCode = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const MilestoneStatus = {
  Pending: 0,
  Submitted: 1,
  ChangesRequested: 2,
  Disputed: 3,
  Released: 4,
  Refunded: 5,
  Resolved: 6,
} as const;
export type MilestoneStatusCode = (typeof MilestoneStatus)[keyof typeof MilestoneStatus];

export interface ChainProject {
  client: Address;
  status: number;
  autoRelease: boolean;
  deadlineReclaim: boolean;
  cancelled: boolean;
  termsVersion: number;
  reclaimGracePeriod: number;
  freelancer: Address;
  acceptedVersion: number;
  milestoneCount: number;
  openDisputes: number;
  arbiter: Address;
  createdAt: bigint;
  cancelProposer: Address;
  fundedAt: bigint;
  termsHash: Hex;
  totalAmount: bigint;
  fundedAmount: bigint;
  releasedAmount: bigint;
  refundedAmount: bigint;
}

export interface ChainMilestone {
  amount: bigint;
  deadline: bigint;
  reviewPeriod: number;
  status: number;
  statusBeforeDispute: number;
  revision: number;
  submittedAt: bigint;
  changesRequestedAt: bigint;
  disputedAt: bigint;
  disputeInitiator: Address;
  settlementProposer: Address;
  proposedFreelancerAmount: bigint;
  submissionHash: Hex;
  releasedAmount: bigint;
  refundedAmount: bigint;
}

export const ZERO = "0x0000000000000000000000000000000000000000";
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const isZero = (a?: string | null) => !a || a.toLowerCase() === ZERO;

export type Role = "client" | "freelancer" | "arbiter" | "viewer";

export function roleOf(project: Pick<ChainProject, "client" | "freelancer" | "arbiter">, who?: string | null): Role {
  if (!who) return "viewer";
  if (same(project.client, who)) return "client";
  if (same(project.freelancer, who)) return "freelancer";
  if (!isZero(project.arbiter) && same(project.arbiter, who)) return "arbiter";
  return "viewer";
}

export const PROJECT_STATUS_LABEL: Record<number, string> = {
  0: "Not on-chain",
  1: "Awaiting agreement",
  2: "Awaiting funding",
  3: "Active",
  4: "Completed",
  5: "Cancelled",
};

/** Display statuses (spec §9). "Approved"/"Payment pending" exist only while a release tx is in flight. */
export type MilestoneDisplay =
  | "draft"
  | "awaiting_agreement"
  | "awaiting_funding"
  | "in_progress"
  | "submitted"
  | "changes_requested"
  | "payment_pending"
  | "paid"
  | "disputed"
  | "resolved"
  | "refunded"
  | "cancelled";

export const MILESTONE_DISPLAY_LABEL: Record<MilestoneDisplay, string> = {
  draft: "Draft",
  awaiting_agreement: "Awaiting agreement",
  awaiting_funding: "Awaiting funding",
  in_progress: "Funded · in progress",
  submitted: "Submitted for review",
  changes_requested: "Changes requested",
  payment_pending: "Approved · payment pending",
  paid: "Paid",
  disputed: "Disputed",
  resolved: "Resolved by settlement",
  refunded: "Refunded to client",
  cancelled: "Cancelled",
};

export type Tone = "neutral" | "held" | "released" | "refunded" | "warning" | "danger" | "info";

export const MILESTONE_DISPLAY_TONE: Record<MilestoneDisplay, Tone> = {
  draft: "neutral",
  awaiting_agreement: "neutral",
  awaiting_funding: "neutral",
  in_progress: "held",
  submitted: "info",
  changes_requested: "warning",
  payment_pending: "info",
  paid: "released",
  disputed: "danger",
  resolved: "released",
  refunded: "refunded",
  cancelled: "refunded",
};

export function milestoneDisplay(
  project: Pick<ChainProject, "status" | "cancelled"> | null,
  m: Pick<ChainMilestone, "status"> | null,
  opts: { releasePending?: boolean } = {},
): MilestoneDisplay {
  if (!project || project.status === ProjectStatus.None) return "draft";
  if (project.status === ProjectStatus.AwaitingAcceptance) return "awaiting_agreement";
  if (project.status === ProjectStatus.AwaitingFunding) return "awaiting_funding";
  if (project.status === ProjectStatus.Cancelled && project.cancelled === false) return "cancelled";
  if (!m) return "in_progress";
  switch (m.status) {
    case MilestoneStatus.Pending:
      return "in_progress";
    case MilestoneStatus.Submitted:
      return opts.releasePending ? "payment_pending" : "submitted";
    case MilestoneStatus.ChangesRequested:
      return opts.releasePending ? "payment_pending" : "changes_requested";
    case MilestoneStatus.Disputed:
      return "disputed";
    case MilestoneStatus.Released:
      return "paid";
    case MilestoneStatus.Refunded:
      return project.cancelled ? "cancelled" : "refunded";
    case MilestoneStatus.Resolved:
      return "resolved";
    default:
      return "in_progress";
  }
}

export const isTerminal = (status: number) =>
  status === MilestoneStatus.Released || status === MilestoneStatus.Refunded || status === MilestoneStatus.Resolved;

export interface Ledger {
  total: bigint;
  funded: bigint;
  released: bigint;
  refunded: bigint;
  held: bigint;
  /** total − funded (only meaningful before funding) */
  unfunded: bigint;
}

export function ledgerOf(p: Pick<ChainProject, "totalAmount" | "fundedAmount" | "releasedAmount" | "refundedAmount">): Ledger {
  const held = p.fundedAmount - p.releasedAmount - p.refundedAmount;
  return {
    total: p.totalAmount,
    funded: p.fundedAmount,
    released: p.releasedAmount,
    refunded: p.refundedAmount,
    held,
    unfunded: p.totalAmount - p.fundedAmount,
  };
}

/** funded == released + refunded + held, and per-milestone settlements add up. */
export function reconcile(p: ChainProject, ms: readonly ChainMilestone[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const l = ledgerOf(p);
  if (l.held < 0n) problems.push("Held amount is negative");
  if (l.funded !== 0n && l.funded !== p.totalAmount) problems.push("Funded amount differs from the total");
  const rel = ms.reduce((a, m) => a + m.releasedAmount, 0n);
  const ref = ms.reduce((a, m) => a + m.refundedAmount, 0n);
  if (rel !== p.releasedAmount) problems.push("Milestone releases do not add up to the project released amount");
  if (ref !== p.refundedAmount) problems.push("Milestone refunds do not add up to the project refunded amount");
  const heldByMilestones =
    l.funded === 0n ? 0n : ms.filter((m) => !isTerminal(m.status)).reduce((a, m) => a + m.amount, 0n);
  if (heldByMilestones !== l.held) problems.push("Held amount differs from the unsettled milestones");
  for (const [i, m] of ms.entries()) {
    if (isTerminal(m.status) && m.releasedAmount + m.refundedAmount !== m.amount) {
      problems.push(`Milestone ${i + 1} settlement does not equal its amount`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export interface ActionState {
  available: boolean;
  reason?: string;
  /** unix seconds when it becomes available (for countdowns) */
  availableAt?: number;
}

export interface MilestoneActions {
  submit: ActionState;
  approve: ActionState;
  requestChanges: ActionState;
  claimTimeout: ActionState;
  reclaim: ActionState;
  openDispute: ActionState;
  proposeSettlement: ActionState;
  acceptSettlement: ActionState;
  withdrawDispute: ActionState;
  arbiterResolve: ActionState;
}

const no = (reason: string, availableAt?: number): ActionState => ({ available: false, reason, availableAt });
const yes: ActionState = { available: true };

export function reviewDeadlineOf(m: Pick<ChainMilestone, "submittedAt" | "reviewPeriod">): number {
  return Number(m.submittedAt) + Number(m.reviewPeriod);
}

export function reclaimAvailableAt(
  p: Pick<ChainProject, "reclaimGracePeriod">,
  m: Pick<ChainMilestone, "deadline" | "status" | "changesRequestedAt">,
): number {
  let at = Number(m.deadline) + Number(p.reclaimGracePeriod);
  if (m.status === MilestoneStatus.ChangesRequested) {
    at = Math.max(at, Number(m.changesRequestedAt) + Number(p.reclaimGracePeriod));
  }
  return at;
}

/** Mirrors every `require` in EscrowFlow for one milestone from `who`'s perspective at `now`. */
export function milestoneActions(p: ChainProject, m: ChainMilestone, who: string | null | undefined, now: number): MilestoneActions {
  const role = roleOf(p, who);
  const active = p.status === ProjectStatus.Active;
  const s = m.status;
  const reviewEnd = reviewDeadlineOf(m);
  const windowElapsed = s === MilestoneStatus.Submitted && now >= reviewEnd;

  const submit: ActionState =
    role !== "freelancer"
      ? no("Only the freelancer can submit work")
      : !active
        ? no("The escrow must be funded first")
        : p.cancelled
          ? no("The project was cancelled")
          : s === MilestoneStatus.Pending || s === MilestoneStatus.ChangesRequested
            ? yes
            : no("This milestone is not open for submission");

  const approve: ActionState =
    role !== "client"
      ? no("Only the client can approve and release")
      : !active
        ? no("The escrow is not active")
        : s === MilestoneStatus.Submitted || s === MilestoneStatus.ChangesRequested
          ? yes
          : no(s === MilestoneStatus.Pending ? "Waiting for a submission" : "This milestone is not awaiting review");

  const requestChanges: ActionState =
    role !== "client"
      ? no("Only the client can request changes")
      : !active
        ? no("The escrow is not active")
        : s !== MilestoneStatus.Submitted
          ? no("Only a submitted milestone can be sent back")
          : p.autoRelease && windowElapsed
            ? no("The agreed review period has ended; the freelancer may now claim")
            : yes;

  const claimTimeout: ActionState =
    role !== "freelancer"
      ? no("Only the freelancer can claim")
      : !p.autoRelease
        ? no("Auto-release after review timeout is not part of these terms")
        : !active
          ? no("The escrow is not active")
          : s !== MilestoneStatus.Submitted
            ? no("Only an unanswered submission can be claimed")
            : now < reviewEnd
              ? no("The client's review period is still running", reviewEnd)
              : yes;

  const reclaimAt = reclaimAvailableAt(p, m);
  const reclaim: ActionState =
    role !== "client"
      ? no("Only the client can reclaim")
      : !p.deadlineReclaim
        ? no("Deadline reclaim is not part of these terms")
        : !active
          ? no("The escrow is not active")
          : s !== MilestoneStatus.Pending && s !== MilestoneStatus.ChangesRequested
            ? no("Submitted, disputed or settled work cannot be reclaimed")
            : now <= reclaimAt
              ? no("Available once the deadline and grace period have passed", reclaimAt + 1)
              : yes;

  const isParty = role === "client" || role === "freelancer";
  const openDispute: ActionState = !isParty
    ? no("Only the client or freelancer can open a dispute")
    : !active
      ? no("The escrow is not active")
      : s !== MilestoneStatus.Pending && s !== MilestoneStatus.Submitted && s !== MilestoneStatus.ChangesRequested
        ? no("This milestone cannot be disputed")
        : role === "client" && p.autoRelease && windowElapsed
          ? no("The agreed review period has ended")
          : yes;

  const disputed = s === MilestoneStatus.Disputed;
  const proposeSettlement: ActionState = !isParty ? no("Only the parties can propose a split") : disputed ? yes : no("No open dispute");
  const hasProposal = !isZero(m.settlementProposer);
  const acceptSettlement: ActionState = !isParty
    ? no("Only the parties can accept a split")
    : !disputed
      ? no("No open dispute")
      : !hasProposal
        ? no("No split has been proposed yet")
        : same(m.settlementProposer, who)
          ? no("Waiting for the other party to respond")
          : yes;
  const withdrawDispute: ActionState = !disputed
    ? no("No open dispute")
    : !same(m.disputeInitiator, who)
      ? no("Only the party who opened the dispute can withdraw it")
      : p.cancelled
        ? no("After a mutual cancellation the dispute must be settled")
        : yes;
  const arbiterResolve: ActionState =
    role !== "arbiter" ? no("Only the agreed arbiter can rule") : disputed ? yes : no("No open dispute");

  return { submit, approve, requestChanges, claimTimeout, reclaim, openDispute, proposeSettlement, acceptSettlement, withdrawDispute, arbiterResolve };
}

export interface ProjectActions {
  acceptTerms: ActionState;
  revokeAcceptance: ActionState;
  editTerms: ActionState;
  fund: ActionState;
  cancelUnfunded: ActionState;
  proposeCancellation: ActionState;
  acceptCancellation: ActionState;
  revokeCancellation: ActionState;
}

export function projectActions(p: ChainProject, who: string | null | undefined, ms: readonly ChainMilestone[], now: number): ProjectActions {
  const role = roleOf(p, who);
  const preFunding = p.status === ProjectStatus.AwaitingAcceptance || p.status === ProjectStatus.AwaitingFunding;
  const active = p.status === ProjectStatus.Active;
  const earliestDeadline = ms.length ? Math.min(...ms.map((m) => Number(m.deadline))) : 0;
  const hasProposal = !isZero(p.cancelProposer);
  return {
    acceptTerms:
      role !== "freelancer"
        ? no("Only the named freelancer can accept")
        : p.status === ProjectStatus.AwaitingAcceptance
          ? yes
          : no(p.status === ProjectStatus.AwaitingFunding ? "Already accepted" : "Terms are no longer open"),
    revokeAcceptance:
      role === "freelancer" && p.status === ProjectStatus.AwaitingFunding ? yes : no("Only before funding, after acceptance"),
    editTerms: role !== "client" ? no("Only the client can edit terms") : preFunding ? yes : no("Terms are locked after funding"),
    fund:
      role !== "client"
        ? no("Only the client funds the escrow")
        : p.status === ProjectStatus.AwaitingAcceptance
          ? no("The freelancer has not accepted the current terms")
          : p.status !== ProjectStatus.AwaitingFunding
            ? no("Already funded or closed")
            : earliestDeadline <= now
              ? no("A milestone deadline has already passed; update the terms first")
              : yes,
    cancelUnfunded: role === "client" && preFunding ? yes : no("Only the client can cancel before funding"),
    proposeCancellation:
      (role === "client" || role === "freelancer") && active && !p.cancelled ? yes : no("Only parties of an active escrow"),
    acceptCancellation:
      (role === "client" || role === "freelancer") && active && !p.cancelled && hasProposal && !same(p.cancelProposer, who)
        ? yes
        : no(hasProposal ? "Waiting for the other party" : "No cancellation proposed"),
    revokeCancellation: hasProposal && same(p.cancelProposer, who) ? yes : no("No cancellation proposal of yours"),
  };
}

/** Amount a mutual cancellation would refund right now (unpaid, undisputed milestones). */
export function cancellationRefundPreview(ms: readonly ChainMilestone[]): { refund: bigint; indexes: number[] } {
  const indexes: number[] = [];
  let refund = 0n;
  ms.forEach((m, i) => {
    if (m.status === MilestoneStatus.Pending || m.status === MilestoneStatus.Submitted || m.status === MilestoneStatus.ChangesRequested) {
      indexes.push(i);
      refund += m.amount;
    }
  });
  return { refund, indexes };
}

export type DeadlineState = "none" | "upcoming" | "due_soon" | "overdue";

/** Warning level for a milestone deadline (only for milestones still awaiting delivery). */
export function deadlineState(m: Pick<ChainMilestone, "deadline" | "status">, now: number, soonSeconds = 2 * 86_400): DeadlineState {
  if (m.status !== MilestoneStatus.Pending && m.status !== MilestoneStatus.ChangesRequested) return "none";
  const d = Number(m.deadline);
  if (now > d) return "overdue";
  if (d - now <= soonSeconds) return "due_soon";
  return "upcoming";
}

/** Review overdue: submitted and the client's review period has elapsed. */
export function reviewOverdue(m: Pick<ChainMilestone, "status" | "submittedAt" | "reviewPeriod">, now: number): boolean {
  return m.status === MilestoneStatus.Submitted && now >= reviewDeadlineOf(m);
}
