import "server-only";
import type { Address } from "viem";
import { query } from "./db";
import { projectIdsFor, readProjects, type ChainSnapshot } from "./chain";
import { chainEventTitle } from "./projects";
import { MilestoneStatus, ProjectStatus, deadlineState, ledgerOf, milestoneActions, projectActions, reviewDeadlineOf, type ChainMilestone, effectiveDeadline } from "@/lib/escrow-state";
import type { TermsDocument } from "@/lib/terms";

interface Linked {
  id: string;
  title: string;
  chain_project_id: string;
  terms: TermsDocument;
}

export interface PendingAction {
  kind: string;
  label: string;
  projectId: string | null;
  chainProjectId: string;
  title: string;
  milestoneIndex: number | null;
  dueAt: number | null;
  href: string;
}

/**
 * Dashboard totals for one wallet, computed from live contract state (never from the DB).
 * "Allocated" (held for a freelancer's active projects) is kept separate from "received".
 */
export async function buildDashboard(address: Address) {
  const me = address.toLowerCase();
  const ids = await projectIdsFor(address);
  const unique = [...new Set([...ids.asClient, ...ids.asFreelancer].map(String))].map((x) => BigInt(x));
  const snaps = await readProjects(unique);
  const linked = unique.length
    ? await query<Linked>(
        `select id, title, chain_project_id::text as chain_project_id, terms from escrowflow.projects where chain_project_id = any($1::bigint[])`,
        [unique.map(String)],
      )
    : [];
  const byChain = new Map(linked.map((l) => [l.chain_project_id, l]));
  const now = Math.floor(Date.now() / 1000);

  const asClient = snaps.filter((s) => s.project.client.toLowerCase() === me);
  const asFreelancer = snaps.filter((s) => s.project.freelancer.toLowerCase() === me);
  const sum = (list: ChainSnapshot[], f: (s: ChainSnapshot) => bigint) => list.reduce((a, s) => a + f(s), 0n);
  const isActive = (s: ChainSnapshot) => s.project.status === ProjectStatus.Active;
  const isOpen = (s: ChainSnapshot) => s.project.status >= ProjectStatus.AwaitingAcceptance && s.project.status <= ProjectStatus.Active;

  const meta = (s: ChainSnapshot) => {
    const l = byChain.get(s.id.toString());
    return {
      projectId: l?.id ?? null,
      title: l?.title ?? `Escrow #${s.id}`,
      href: l ? `/projects/${l.id}` : `/escrow/${s.id}`,
      milestoneTitle: (i: number) => l?.terms.milestones[i]?.title ?? `Milestone ${i + 1}`,
    };
  };

  const actions: PendingAction[] = [];
  const deadlines: { title: string; milestone: string; href: string; dueAt: number; state: string; role: string; amount: bigint }[] = [];
  const disputes: { title: string; milestone: string; href: string; amount: bigint; openedAt: number }[] = [];
  const reviews: { title: string; milestone: string; href: string; amount: bigint; reviewEndsAt: number; overdue: boolean; role: string }[] = [];

  for (const s of snaps) {
    const m = meta(s);
    const pa = projectActions(s.project, address, s.milestones, now);
    const base = { projectId: m.projectId, chainProjectId: s.id.toString(), title: m.title, href: m.href };
    if (pa.acceptTerms.available) actions.push({ ...base, kind: "accept", label: "Review and accept the terms", milestoneIndex: null, dueAt: null });
    if (pa.fund.available) actions.push({ ...base, kind: "fund", label: "Fund the escrow", milestoneIndex: null, dueAt: null });
    if (pa.acceptCancellation.available) actions.push({ ...base, kind: "cancellation", label: "Respond to the cancellation proposal", milestoneIndex: null, dueAt: null });
    s.milestones.forEach((ms: ChainMilestone, i) => {
      const ma = milestoneActions(s.project, ms, address, now);
      const role = s.project.client.toLowerCase() === me ? "client" : "freelancer";
      const mt = `M${i + 1} · ${m.milestoneTitle(i)}`;
      // Milestone screens exist only for projects with an app record; public escrows link to the facts page.
      const msHref = (sub = "") => (m.projectId ? `${m.href}/milestones/${i}${sub}` : m.href);
      if (ms.status === MilestoneStatus.Submitted) {
        reviews.push({ title: m.title, milestone: mt, href: msHref(role === "client" ? "/review" : ""), amount: ms.amount, reviewEndsAt: reviewDeadlineOf(ms), overdue: now >= reviewDeadlineOf(ms), role });
      }
      if (ma.approve.available && ms.status === MilestoneStatus.Submitted) {
        actions.push({ ...base, href: msHref("/review"), kind: "review", label: `Review ${mt}`, milestoneIndex: i, dueAt: reviewDeadlineOf(ms) });
      }
      if (ma.submit.available) actions.push({ ...base, href: msHref("/submit"), kind: "submit", label: `Deliver ${mt}`, milestoneIndex: i, dueAt: effectiveDeadline(ms) });
      if (ma.claimTimeout.available) actions.push({ ...base, href: msHref(), kind: "claim", label: `Claim ${mt} — review period elapsed`, milestoneIndex: i, dueAt: null });
      if (ma.acceptSettlement.available) actions.push({ ...base, href: msHref(), kind: "settlement", label: `Respond to the settlement offer on ${mt}`, milestoneIndex: i, dueAt: null });
      if (ma.reclaim.available) actions.push({ ...base, href: msHref(), kind: "reclaim", label: `Reclaim ${mt} — deadline passed without delivery`, milestoneIndex: i, dueAt: null });
      if (isActive(s)) {
        const ds = deadlineState(ms, now, 7 * 86_400);
        if (ds !== "none") deadlines.push({ title: m.title, milestone: mt, href: msHref(), dueAt: effectiveDeadline(ms), state: ds, role, amount: ms.amount });
      }
      if (ms.status === MilestoneStatus.Disputed) {
        disputes.push({ title: m.title, milestone: mt, href: m.href, amount: ms.amount, openedAt: Number(ms.disputedAt) });
      }
    });
  }

  const recent = unique.length
    ? await query<{ tx_hash: string; block_time: string | null; event_name: string; chain_project_id: string; milestone_index: number | null; args: Record<string, string> }>(
        `select tx_hash, block_time, event_name, chain_project_id::text as chain_project_id, milestone_index, args
           from escrowflow.chain_events
          where chain_project_id = any($1::bigint[])
            and event_name in ('ProjectFunded','MilestoneReleased','MilestoneRefunded','DisputeResolved')
          order by block_number desc, log_index desc limit 12`,
        [unique.map(String)],
      )
    : [];

  return {
    address,
    generatedAt: new Date().toISOString(),
    client: {
      lockedWei: sum(asClient, (s) => ledgerOf(s.project).held),
      releasedWei: sum(asClient, (s) => s.project.releasedAmount),
      refundedWei: sum(asClient, (s) => s.project.refundedAmount),
      awaitingFundingWei: sum(asClient.filter((s) => s.project.status <= ProjectStatus.AwaitingFunding && s.project.status > 0), (s) => s.project.totalAmount),
      activeProjects: asClient.filter(isOpen).length,
      pendingReviews: reviews.filter((r) => r.role === "client").length,
      openDisputes: asClient.reduce((n, s) => n + s.project.openDisputes, 0),
    },
    freelancer: {
      receivedWei: sum(asFreelancer, (s) => s.project.releasedAmount),
      allocatedWei: sum(asFreelancer, (s) => ledgerOf(s.project).held),
      pendingPaymentWei: asFreelancer.reduce(
        (a, s) => a + s.milestones.filter((x) => x.status === MilestoneStatus.Submitted).reduce((b, x) => b + x.amount, 0n),
        0n,
      ),
      activeProjects: asFreelancer.filter(isOpen).length,
      awaitingReview: reviews.filter((r) => r.role === "freelancer").length,
      openDisputes: asFreelancer.reduce((n, s) => n + s.project.openDisputes, 0),
    },
    projects: snaps.map((s) => {
      const m = meta(s);
      return {
        chainProjectId: s.id.toString(),
        projectId: m.projectId,
        title: m.title,
        href: m.href,
        role: s.project.client.toLowerCase() === me ? "client" : "freelancer",
        status: s.project.status,
        ledger: ledgerOf(s.project),
        milestoneStatuses: s.milestones.map((x) => x.status),
        milestoneAmounts: s.milestones.map((x) => x.amount),
        counterparty: s.project.client.toLowerCase() === me ? s.project.freelancer : s.project.client,
      };
    }),
    actions,
    deadlines: deadlines.sort((a, b) => a.dueAt - b.dueAt).slice(0, 12),
    reviews,
    disputes,
    recentPayments: recent.map((r) => ({
      txHash: r.tx_hash,
      at: r.block_time,
      event: r.event_name,
      title: chainEventTitle(r.event_name),
      chainProjectId: r.chain_project_id,
      projectTitle: byChain.get(r.chain_project_id)?.title ?? `Escrow #${r.chain_project_id}`,
      milestoneIndex: r.milestone_index,
      amountWei: r.args.amount ?? r.args.freelancerAmount ?? r.args.refundedAmount ?? "0",
    })),
    blockNumber: snaps[0]?.blockNumber.toString() ?? null,
  };
}
