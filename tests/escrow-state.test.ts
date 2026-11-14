import { describe, expect, it } from "vitest";
import {
  MilestoneStatus as M,
  ProjectStatus as P,
  ZERO,
  cancellationRefundPreview,
  deadlineState,
  ledgerOf,
  milestoneActions,
  milestoneDisplay,
  projectActions,
  reclaimAvailableAt,
  reconcile,
  reviewOverdue,
  roleOf,
  splitYield,
  type ChainMilestone,
  type ChainProject,
} from "@/lib/escrow-state";
import { parseMusd } from "@/lib/money";

const CLIENT = "0x85bFEB7feA972E1269f14526e0195A7a841a3EfE" as const;
const FREELANCER = "0x430999F89D1D1425E48af2904DCa0CFe2Cd7034f" as const;
const STRANGER = "0xA8A724830bF7EA24Bbbe72B12ad95be6D016e25A" as const;
const ARBITER = "0x242097EC010825a937cE0644c1DeF52bda2FcC5e" as const;
const NOW = 1_800_000_000;

function project(over: Partial<ChainProject> = {}): ChainProject {
  return {
    client: CLIENT,
    status: P.Active,
    autoRelease: true,
    deadlineReclaim: true,
    cancelled: false,
    termsVersion: 1,
    reclaimGracePeriod: 86_400,
    freelancer: FREELANCER,
    acceptedVersion: 1,
    milestoneCount: 4,
    openDisputes: 0,
    arbiter: ZERO,
    createdAt: BigInt(NOW - 10_000),
    cancelProposer: ZERO,
    fundedAt: BigInt(NOW - 5_000),
    termsHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    totalAmount: parseMusd("200"),
    fundedAmount: parseMusd("200"),
    releasedAmount: 0n,
    refundedAmount: 0n,
    ...over,
  };
}

function ms(amount: string, over: Partial<ChainMilestone> = {}): ChainMilestone {
  return {
    amount: parseMusd(amount),
    deadline: BigInt(NOW + 7 * 86_400),
    reviewPeriod: 3 * 86_400,
    status: M.Pending,
    statusBeforeDispute: 0,
    revision: 0,
    submittedAt: 0n,
    changesRequestedAt: 0n,
    disputedAt: 0n,
    disputeInitiator: ZERO,
    settlementProposer: ZERO,
    proposedFreelancerAmount: 0n,
    submissionHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    releasedAmount: 0n,
    refundedAmount: 0n,
    pausedFor: 0n,
    ...over,
  };
}

describe("roles", () => {
  it("resolves client / freelancer / arbiter / viewer case-insensitively", () => {
    const p = project({ arbiter: ARBITER });
    expect(roleOf(p, CLIENT.toLowerCase())).toBe("client");
    expect(roleOf(p, FREELANCER)).toBe("freelancer");
    expect(roleOf(p, ARBITER)).toBe("arbiter");
    expect(roleOf(p, STRANGER)).toBe("viewer");
    expect(roleOf(p, null)).toBe("viewer");
    expect(roleOf(project(), ZERO)).toBe("viewer");
  });
});

describe("ledger + reconciliation (spec §26: 40 released / 160 held)", () => {
  it("after M1 release: funded 200 = released 40 + held 160", () => {
    const p = project({ releasedAmount: parseMusd("40") });
    const list = [ms("40", { status: M.Released, releasedAmount: parseMusd("40") }), ms("60"), ms("60"), ms("40")];
    const l = ledgerOf(p);
    expect(l.released).toBe(parseMusd("40"));
    expect(l.held).toBe(parseMusd("160"));
    expect(l.funded).toBe(l.released + l.refunded + l.held);
    expect(reconcile(p, list)).toEqual({ ok: true, problems: [] });
  });
  it("detects a ledger that does not reconcile", () => {
    const p = project({ releasedAmount: parseMusd("50") });
    const list = [ms("40", { status: M.Released, releasedAmount: parseMusd("40") }), ms("60"), ms("60"), ms("40")];
    expect(reconcile(p, list).ok).toBe(false);
  });
  it("split settlement + cancellation still reconciles", () => {
    const p = project({ releasedAmount: parseMusd("70"), refundedAmount: parseMusd("130"), status: P.Cancelled, cancelled: true });
    const list = [
      ms("40", { status: M.Released, releasedAmount: parseMusd("40") }),
      ms("60", { status: M.Resolved, releasedAmount: parseMusd("30"), refundedAmount: parseMusd("30") }),
      ms("60", { status: M.Refunded, refundedAmount: parseMusd("60") }),
      ms("40", { status: M.Refunded, refundedAmount: parseMusd("40") }),
    ];
    expect(ledgerOf(p).held).toBe(0n);
    expect(reconcile(p, list).ok).toBe(true);
  });
  it("unfunded projects hold nothing", () => {
    const p = project({ status: P.AwaitingFunding, fundedAmount: 0n });
    expect(ledgerOf(p).held).toBe(0n);
    expect(ledgerOf(p).unfunded).toBe(parseMusd("200"));
    expect(reconcile(p, [ms("40"), ms("60"), ms("60"), ms("40")]).ok).toBe(true);
  });
});

describe("display statuses never show paid without on-chain release", () => {
  it("maps contract states to spec statuses", () => {
    expect(milestoneDisplay(null, null)).toBe("draft");
    expect(milestoneDisplay(project({ status: P.AwaitingAcceptance }), ms("1"))).toBe("awaiting_agreement");
    expect(milestoneDisplay(project({ status: P.AwaitingFunding }), ms("1"))).toBe("awaiting_funding");
    expect(milestoneDisplay(project(), ms("1"))).toBe("in_progress");
    expect(milestoneDisplay(project(), ms("1", { status: M.Submitted }))).toBe("submitted");
    expect(milestoneDisplay(project(), ms("1", { status: M.Submitted }), { releasePending: true })).toBe("payment_pending");
    expect(milestoneDisplay(project(), ms("1", { status: M.ChangesRequested }))).toBe("changes_requested");
    expect(milestoneDisplay(project(), ms("1", { status: M.Disputed }))).toBe("disputed");
    expect(milestoneDisplay(project(), ms("1", { status: M.Released }))).toBe("paid");
    expect(milestoneDisplay(project(), ms("1", { status: M.Resolved }))).toBe("resolved");
    expect(milestoneDisplay(project(), ms("1", { status: M.Refunded }))).toBe("refunded");
    expect(milestoneDisplay(project({ cancelled: true }), ms("1", { status: M.Refunded }))).toBe("cancelled");
    expect(milestoneDisplay(project({ status: P.Cancelled }), ms("1"))).toBe("cancelled");
  });
  it("a pending release on a submitted milestone is 'payment pending', never 'paid'", () => {
    expect(milestoneDisplay(project(), ms("1", { status: M.Submitted }), { releasePending: true })).not.toBe("paid");
  });
});

describe("milestone actions mirror the contract", () => {
  const submitted = ms("40", { status: M.Submitted, submittedAt: BigInt(NOW - 3_600), revision: 1 });
  it("only the freelancer submits, only on funded Pending/ChangesRequested", () => {
    expect(milestoneActions(project(), ms("40"), FREELANCER, NOW).submit.available).toBe(true);
    expect(milestoneActions(project(), ms("40"), CLIENT, NOW).submit.available).toBe(false);
    expect(milestoneActions(project({ status: P.AwaitingFunding }), ms("40"), FREELANCER, NOW).submit.available).toBe(false);
    expect(milestoneActions(project({ cancelled: true }), ms("40"), FREELANCER, NOW).submit.available).toBe(false);
    expect(milestoneActions(project(), submitted, FREELANCER, NOW).submit.available).toBe(false);
  });
  it("only the client approves submitted work; strangers and freelancers cannot", () => {
    expect(milestoneActions(project(), submitted, CLIENT, NOW).approve.available).toBe(true);
    expect(milestoneActions(project(), submitted, STRANGER, NOW).approve.available).toBe(false);
    expect(milestoneActions(project(), submitted, FREELANCER, NOW).approve.available).toBe(false);
    expect(milestoneActions(project(), ms("40"), CLIENT, NOW).approve.available).toBe(false);
    expect(milestoneActions(project(), ms("40", { status: M.Released }), CLIENT, NOW).approve.available).toBe(false);
  });
  it("review-timeout claim: blocked inside the window, available after, only with autoRelease", () => {
    const inWindow = milestoneActions(project(), submitted, FREELANCER, NOW);
    expect(inWindow.claimTimeout.available).toBe(false);
    expect(inWindow.claimTimeout.availableAt).toBe(NOW - 3_600 + 3 * 86_400);
    const after = NOW + 3 * 86_400;
    expect(milestoneActions(project(), submitted, FREELANCER, after).claimTimeout.available).toBe(true);
    expect(milestoneActions(project({ autoRelease: false }), submitted, FREELANCER, after).claimTimeout.available).toBe(false);
  });
  it("client cannot request changes or dispute once an agreed auto-release has vested", () => {
    const after = NOW + 3 * 86_400;
    const a = milestoneActions(project(), submitted, CLIENT, after);
    expect(a.requestChanges.available).toBe(false);
    expect(a.openDispute.available).toBe(false);
    expect(a.approve.available).toBe(true);
    const noAuto = milestoneActions(project({ autoRelease: false }), submitted, CLIENT, after);
    expect(noAuto.requestChanges.available).toBe(true);
    expect(milestoneActions(project(), submitted, FREELANCER, after).openDispute.available).toBe(true);
  });
  it("deadline reclaim requires the flag, an undelivered milestone and deadline + grace", () => {
    const m = ms("40", { deadline: BigInt(NOW - 2 * 86_400) });
    expect(milestoneActions(project(), m, CLIENT, NOW).reclaim.available).toBe(true);
    expect(milestoneActions(project({ deadlineReclaim: false }), m, CLIENT, NOW).reclaim.available).toBe(false);
    const inGrace = ms("40", { deadline: BigInt(NOW - 3_600) });
    expect(milestoneActions(project(), inGrace, CLIENT, NOW).reclaim.available).toBe(false);
    expect(milestoneActions(project(), { ...m, status: M.Submitted }, CLIENT, NOW).reclaim.available).toBe(false);
    expect(milestoneActions(project(), m, FREELANCER, NOW).reclaim.available).toBe(false);
  });
  it("reclaim after a change request also waits for changesRequestedAt + grace", () => {
    const p = project();
    const m = ms("40", { status: M.ChangesRequested, deadline: BigInt(NOW - 5 * 86_400), changesRequestedAt: BigInt(NOW - 3_600) });
    expect(reclaimAvailableAt(p, m)).toBe(NOW - 3_600 + 86_400);
    expect(milestoneActions(p, m, CLIENT, NOW).reclaim.available).toBe(false);
    expect(milestoneActions(p, m, CLIENT, NOW + 86_400).reclaim.available).toBe(true);
  });
  it("disputes freeze payouts and settlement needs the counterparty", () => {
    const d = ms("60", { status: M.Disputed, disputeInitiator: CLIENT, settlementProposer: CLIENT, proposedFreelancerAmount: parseMusd("30") });
    const c = milestoneActions(project(), d, CLIENT, NOW);
    const f = milestoneActions(project(), d, FREELANCER, NOW);
    expect(c.approve.available).toBe(false);
    expect(f.claimTimeout.available).toBe(false);
    expect(c.reclaim.available).toBe(false);
    expect(c.acceptSettlement.available).toBe(false);
    expect(f.acceptSettlement.available).toBe(true);
    expect(c.withdrawDispute.available).toBe(true);
    expect(f.withdrawDispute.available).toBe(false);
    expect(milestoneActions(project({ cancelled: true }), d, CLIENT, NOW).withdrawDispute.available).toBe(false);
    expect(milestoneActions(project(), d, STRANGER, NOW).proposeSettlement.available).toBe(false);
    expect(milestoneActions(project({ arbiter: ARBITER }), d, ARBITER, NOW).arbiterResolve.available).toBe(true);
    expect(milestoneActions(project(), d, ARBITER, NOW).arbiterResolve.available).toBe(false);
  });
});

describe("project actions", () => {
  const list = [ms("40"), ms("60"), ms("60"), ms("40")];
  it("agreement and funding flow", () => {
    const awaiting = project({ status: P.AwaitingAcceptance, fundedAmount: 0n, acceptedVersion: 0 });
    expect(projectActions(awaiting, FREELANCER, list, NOW).acceptTerms.available).toBe(true);
    expect(projectActions(awaiting, CLIENT, list, NOW).fund.available).toBe(false);
    expect(projectActions(awaiting, CLIENT, list, NOW).editTerms.available).toBe(true);
    const agreed = project({ status: P.AwaitingFunding, fundedAmount: 0n });
    expect(projectActions(agreed, CLIENT, list, NOW).fund.available).toBe(true);
    expect(projectActions(agreed, STRANGER, list, NOW).fund.available).toBe(false);
    expect(projectActions(agreed, FREELANCER, list, NOW).revokeAcceptance.available).toBe(true);
    expect(projectActions(project(), CLIENT, list, NOW).editTerms.available).toBe(false);
  });
  it("funding is blocked once a deadline has passed", () => {
    const agreed = project({ status: P.AwaitingFunding, fundedAmount: 0n });
    expect(projectActions(agreed, CLIENT, [ms("40", { deadline: BigInt(NOW - 1) })], NOW).fund.available).toBe(false);
  });
  it("mutual cancellation needs the other party", () => {
    const proposed = project({ cancelProposer: CLIENT });
    expect(projectActions(proposed, CLIENT, list, NOW).acceptCancellation.available).toBe(false);
    expect(projectActions(proposed, FREELANCER, list, NOW).acceptCancellation.available).toBe(true);
    expect(projectActions(proposed, CLIENT, list, NOW).revokeCancellation.available).toBe(true);
  });
  it("cancellation preview refunds only unpaid, undisputed milestones", () => {
    const mixed = [
      ms("40", { status: M.Released }),
      ms("60", { status: M.Disputed }),
      ms("60", { status: M.Submitted }),
      ms("40"),
    ];
    expect(cancellationRefundPreview(mixed)).toEqual({ refund: parseMusd("100"), indexes: [2, 3] });
  });
});

describe("deadline warnings", () => {
  it("classifies upcoming / due soon / overdue / none", () => {
    expect(deadlineState(ms("1", { deadline: BigInt(NOW + 10 * 86_400) }), NOW)).toBe("upcoming");
    expect(deadlineState(ms("1", { deadline: BigInt(NOW + 3_600) }), NOW)).toBe("due_soon");
    expect(deadlineState(ms("1", { deadline: BigInt(NOW - 1) }), NOW)).toBe("overdue");
    expect(deadlineState(ms("1", { deadline: BigInt(NOW - 1), status: M.Submitted }), NOW)).toBe("none");
  });
  it("review overdue only for submitted work past its review period", () => {
    const s = ms("1", { status: M.Submitted, submittedAt: BigInt(NOW - 4 * 86_400) });
    expect(reviewOverdue(s, NOW)).toBe(true);
    expect(reviewOverdue({ ...s, submittedAt: BigInt(NOW) }, NOW)).toBe(false);
    expect(reviewOverdue({ ...s, status: M.Released }, NOW)).toBe(false);
  });
});

describe("v2 rules mirrored from the audit fixes", () => {
  it("a freelancer cannot dispute a milestone they never submitted; the client still can", () => {
    const pending = ms("40");
    expect(milestoneActions(project(), pending, FREELANCER, NOW).openDispute.available).toBe(false);
    expect(milestoneActions(project(), pending, CLIENT, NOW).openDispute.available).toBe(true);
    expect(milestoneActions(project(), { ...pending, revision: 1, status: M.ChangesRequested }, FREELANCER, NOW).openDispute.available).toBe(true);
  });

  it("time spent in a withdrawn dispute pushes reclaim and deadline warnings back", () => {
    const m = ms("40", { deadline: BigInt(NOW - 3_600) });
    const paused = { ...m, pausedFor: 7_200n };
    expect(reclaimAvailableAt(project(), paused)).toBe(reclaimAvailableAt(project(), m) + 7_200);
    expect(deadlineState(m, NOW)).toBe("overdue");
    expect(deadlineState(paused, NOW)).not.toBe("overdue");
  });

  it("splits savings yield like the contract (freelancer share rounds down)", () => {
    expect(splitYield(101n, 5000)).toEqual({ freelancer: 50n, client: 51n });
    expect(splitYield(1000n, 0)).toEqual({ freelancer: 0n, client: 1000n });
    expect(splitYield(1000n, 10_000)).toEqual({ freelancer: 1000n, client: 0n });
  });
});
