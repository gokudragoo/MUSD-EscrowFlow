import { after } from "next/server";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { projectIdsFor, readProjects } from "@/lib/server/chain";
import { query } from "@/lib/server/db";
import { syncIfStale } from "@/lib/server/indexer";
import { MilestoneStatus, isZero } from "@/lib/escrow-state";
import type { TermsDocument } from "@/lib/terms";

export const dynamic = "force-dynamic";

/** Open and past disputes on the signed-in wallet's escrows (incl. as arbiter), from contract state + events. */
export const GET = route(async () => {
  const s = await requireSession();
  after(() => syncIfStale());
  const me = s.address.toLowerCase();
  const ids = await projectIdsFor(s.address);
  const arb = await query<{ id: string }>(
    `select distinct chain_project_id::text as id from escrowflow.chain_events where event_name = 'TermsSet' and lower(args->>'arbiter') = $1`,
    [me],
  );
  const all = [...new Set([...ids.asClient, ...ids.asFreelancer].map(String).concat(arb.map((a) => a.id)))];
  const snaps = await readProjects(all.map((x) => BigInt(x)));
  const rows = all.length
    ? await query<{ id: string; title: string; chain_project_id: string; terms: TermsDocument }>(
        `select id, title, chain_project_id::text as chain_project_id, terms from escrowflow.projects where chain_project_id = any($1::bigint[])`,
        [all],
      )
    : [];
  const byChain = new Map(rows.map((r) => [r.chain_project_id, r]));
  const history = all.length
    ? await query<{ chain_project_id: string; milestone_index: number; event_name: string; args: Record<string, string>; tx_hash: string; block_time: string | null }>(
        `select chain_project_id::text as chain_project_id, milestone_index, event_name, args, tx_hash, block_time from escrowflow.chain_events
          where chain_project_id = any($1::bigint[]) and event_name in ('DisputeResolved','DisputeWithdrawn')
          order by block_number desc, log_index desc limit 100`,
        [all],
      )
    : [];

  const open = snaps.flatMap((snap) =>
    snap.milestones
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.status === MilestoneStatus.Disputed)
      .map(({ m, i }) => {
        const row = byChain.get(snap.id.toString());
        const role =
          snap.project.client.toLowerCase() === me ? "client" : snap.project.freelancer.toLowerCase() === me ? "freelancer" : "arbiter";
        return {
          chainProjectId: snap.id.toString(),
          projectId: row?.id ?? null,
          title: row?.title ?? `Escrow #${snap.id}`,
          milestoneIndex: i,
          milestoneTitle: row?.terms.milestones[i]?.title ?? `Milestone ${i + 1}`,
          amountWei: m.amount.toString(),
          initiator: m.disputeInitiator,
          openedAt: Number(m.disputedAt),
          settlementProposer: isZero(m.settlementProposer) ? null : m.settlementProposer,
          proposedFreelancerAmountWei: m.proposedFreelancerAmount.toString(),
          arbiter: isZero(snap.project.arbiter) ? null : snap.project.arbiter,
          role,
          status: isZero(m.settlementProposer) ? "Opened · awaiting evidence or a proposal" : "Under review · settlement proposed",
        };
      }),
  );
  const closed = history.map((h) => ({
    chainProjectId: h.chain_project_id,
    projectId: byChain.get(h.chain_project_id)?.id ?? null,
    title: byChain.get(h.chain_project_id)?.title ?? `Escrow #${h.chain_project_id}`,
    milestoneIndex: h.milestone_index,
    outcome: h.event_name === "DisputeResolved" ? (Number(h.args.kind) === 1 ? "Arbiter ruling" : "Mutual settlement") : "Withdrawn",
    freelancerAmountWei: h.args.freelancerAmount ?? null,
    clientAmountWei: h.args.clientAmount ?? null,
    txHash: h.tx_hash,
    at: h.block_time,
  }));
  return json({ open, closed });
});
