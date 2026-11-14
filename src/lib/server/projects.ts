import "server-only";
import { getAddress, zeroAddress, type Address } from "viem";
import { compareTermsWithChain, hashTerms, type TermsDocument } from "@/lib/terms";
import { chainSavingsTerms, ledgerOf, reconcile, roleOf } from "@/lib/escrow-state";
import { one, query } from "./db";
import { forbidden, notFound } from "./http";
import { readProject, type ChainSnapshot } from "./chain";

export interface ProjectRow {
  id: string;
  client_address: string;
  freelancer_address: string | null;
  title: string;
  summary: string;
  category: string;
  skills: string[];
  budget_wei: string;
  milestone_count: number;
  final_deadline: string;
  hiring_mode: "direct" | "open";
  listing_status: "draft" | "open" | "closed";
  terms: TermsDocument;
  terms_hash: string;
  chain_project_id: string | null;
  create_tx_hash: string | null;
  created_at: string;
  updated_at: string;
}

export const PROJECT_COLUMNS = `id, client_address, freelancer_address, title, summary, category, skills, budget_wei::text as budget_wei,
  milestone_count, final_deadline, hiring_mode, listing_status, terms, terms_hash, chain_project_id::text as chain_project_id,
  create_tx_hash, created_at, updated_at`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

export async function getProjectRow(id: string): Promise<ProjectRow | null> {
  if (!isUuid(id)) return null;
  return one<ProjectRow>(`select ${PROJECT_COLUMNS} from escrowflow.projects where id = $1`, [id]);
}

export async function getProjectRowByChainId(chainId: bigint): Promise<ProjectRow | null> {
  return one<ProjectRow>(`select ${PROJECT_COLUMNS} from escrowflow.projects where chain_project_id = $1`, [chainId.toString()]);
}

export type Access = "client" | "freelancer" | "arbiter" | "applicant" | "public";

const eq = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Who is asking, relative to this project. Once an escrow is linked the contract alone decides who
 * the freelancer and arbiter are (the editable DB draft can drift from what was committed on-chain).
 * The client never changes: /link requires the DB client to equal the on-chain client.
 */
export async function accessOf(row: ProjectRow, chain: ChainSnapshot | null, viewer: Address | null): Promise<Access> {
  if (!viewer) return "public";
  if (eq(row.client_address, viewer) || (chain && eq(chain.project.client, viewer))) return "client";
  if (chain) {
    if (eq(chain.project.freelancer, viewer)) return "freelancer";
    if (chain.project.arbiter !== zeroAddress && eq(chain.project.arbiter, viewer)) return "arbiter";
  } else if (!row.chain_project_id) {
    if (eq(row.freelancer_address, viewer)) return "freelancer";
    if (row.terms.rules.arbiter && eq(row.terms.rules.arbiter, viewer)) return "arbiter";
  }
  // Applicants see the listing terms only while it is open and their application is live.
  if (row.listing_status !== "open") return "public";
  const app = await one<{ status: string }>(`select status from escrowflow.applications where project_id = $1 and freelancer_address = $2`, [
    row.id,
    viewer.toLowerCase(),
  ]);
  return app && (app.status === "submitted" || app.status === "selected") ? "applicant" : "public";
}

export const isParty = (a: Access) => a === "client" || a === "freelancer" || a === "arbiter";

export async function requireProjectAccess(id: string, viewer: Address, allowed: Access[]) {
  const row = await getProjectRow(id);
  if (!row) throw notFound("Project not found");
  const chain = row.chain_project_id ? await readProject(BigInt(row.chain_project_id)) : null;
  const access = await accessOf(row, chain, viewer);
  if (!allowed.includes(access)) throw forbidden();
  return { row, chain, access };
}

export interface TimelineItem {
  at: string;
  source: "chain" | "app";
  kind: string;
  title: string;
  detail?: string;
  actor?: string | null;
  txHash?: string | null;
  blockNumber?: string | null;
  milestoneIndex?: number | null;
}

const EVENT_TITLES: Record<string, string> = {
  ProjectCreated: "Escrow created on-chain",
  TermsSet: "Terms recorded on-chain",
  TermsAccepted: "Terms accepted by freelancer",
  AcceptanceRevoked: "Freelancer withdrew acceptance",
  ProjectFunded: "Escrow funded",
  MilestoneSubmitted: "Milestone submitted",
  ChangesRequested: "Changes requested",
  MilestoneReleased: "Payment released",
  MilestoneRefunded: "Refunded to client",
  DisputeOpened: "Dispute opened",
  SettlementProposed: "Settlement proposed",
  DisputeResolved: "Dispute resolved",
  DisputeWithdrawn: "Dispute withdrawn",
  CancellationProposed: "Cancellation proposed",
  CancellationRevoked: "Cancellation proposal withdrawn",
  ProjectCancelled: "Project cancelled",
  ProjectClosed: "Project closed",
  YieldTermsSet: "Savings terms recorded on-chain",
  SavingsDeposited: "Budget deposited into sMUSD savings",
  SavingsWithdrawn: "Withdrawn from sMUSD for settlement",
  YieldDistributed: "Savings yield paid out",
};

export interface ChainEventRow {
  block_number: string;
  block_time: string | null;
  tx_hash: string;
  log_index: number;
  event_name: string;
  chain_project_id: string;
  milestone_index: number | null;
  args: Record<string, string | number | boolean>;
  created_at: string;
}

export async function chainEventsFor(chainIds: string[]): Promise<ChainEventRow[]> {
  if (chainIds.length === 0) return [];
  return query<ChainEventRow>(
    `select block_number::text as block_number, block_time, tx_hash, log_index, event_name, chain_project_id::text as chain_project_id,
            milestone_index, args, created_at
       from escrowflow.chain_events where chain_project_id = any($1::bigint[])
       order by block_number asc, log_index asc`,
    [chainIds],
  );
}

export function chainEventTitle(name: string) {
  return EVENT_TITLES[name] ?? name;
}

export async function buildTimeline(row: ProjectRow, includePrivate: boolean): Promise<TimelineItem[]> {
  const items: TimelineItem[] = [];
  if (row.chain_project_id) {
    for (const e of await chainEventsFor([row.chain_project_id])) {
      items.push({
        at: e.block_time ?? e.created_at,
        source: "chain",
        kind: e.event_name,
        title: chainEventTitle(e.event_name),
        actor: (e.args.by ?? e.args.client ?? e.args.freelancer ?? e.args.resolver ?? null) as string | null,
        txHash: e.tx_hash,
        blockNumber: e.block_number,
        milestoneIndex: e.milestone_index,
        detail: describeArgs(e.event_name, e.args),
      });
    }
  }
  if (includePrivate) {
    const audits = await query<{ actor: string; action: string; detail: Record<string, unknown>; created_at: string }>(
      `select actor, action, detail, created_at from escrowflow.audit_events where project_id = $1 order by created_at`,
      [row.id],
    );
    for (const a of audits) {
      items.push({
        at: a.created_at,
        source: "app",
        kind: a.action,
        title: (a.detail.title as string) ?? a.action,
        detail: (a.detail.summary as string) ?? undefined,
        actor: a.actor,
        milestoneIndex: (a.detail.milestoneIndex as number | undefined) ?? null,
      });
    }
  }
  return items.sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());
}

function describeArgs(name: string, a: Record<string, string | number | boolean>): string | undefined {
  const musd = (v: unknown) => {
    try {
      const w = BigInt(String(v));
      const whole = w / 10n ** 18n;
      const frac = (w % 10n ** 18n).toString().padStart(18, "0").slice(0, 2);
      return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac} MUSD`;
    } catch {
      return String(v);
    }
  };
  switch (name) {
    case "TermsSet":
      return `Version ${a.version} · ${musd(a.totalAmount)} across ${a.milestoneCount} milestones`;
    case "TermsAccepted":
      return `Version ${a.version}`;
    case "ProjectFunded":
      return musd(a.amount);
    case "MilestoneSubmitted":
      return `Revision ${a.revision}`;
    case "MilestoneReleased":
      return `${musd(a.amount)} to freelancer${Number(a.kind) === 1 ? " (claimed after review period)" : ""}`;
    case "MilestoneRefunded":
      return `${musd(a.amount)} to client${Number(a.kind) === 0 ? " (deadline reclaim)" : " (mutual cancellation)"}`;
    case "SettlementProposed":
      return `${musd(a.freelancerAmount)} to freelancer proposed`;
    case "DisputeResolved":
      return `${musd(a.freelancerAmount)} to freelancer · ${musd(a.clientAmount)} to client`;
    case "ProjectCancelled":
      return a.wasFunded ? `${musd(a.refundedAmount)} refunded` : "Before funding";
    case "ProjectClosed":
      return Number(a.finalStatus) === 4 ? "Completed" : "Cancelled";
    case "YieldTermsSet":
      return a.enabled ? `Held MUSD earns the sMUSD savings rate · ${Number(a.freelancerYieldBps) / 100}% of yield to the freelancer` : "Savings off";
    case "SavingsDeposited":
    case "SavingsWithdrawn":
      return `${musd(a.amount)} (Mezo MUSDSavingsRate vault, 1:1 principal)`;
    case "YieldDistributed":
      return `${musd(a.freelancerAmount)} to freelancer · ${musd(a.clientAmount)} to client`;
    case "DisputeWithdrawn":
      return Number(a.pausedSeconds ?? 0) > 0 ? `Clocks paused for ${Math.round(Number(a.pausedSeconds) / 60)} min during the dispute` : undefined;
    default:
      return undefined;
  }
}

/** Finds the stored terms revision whose hash the contract committed to. */
export async function revisionForHash(projectId: string, hash: string) {
  return one<{ revision: number; terms: TermsDocument; terms_hash: string; created_at: string }>(
    `select revision, terms, terms_hash, created_at from escrowflow.terms_revisions
      where project_id = $1 and lower(terms_hash) = lower($2) order by revision desc limit 1`,
    [projectId, hash],
  );
}

/** The full project view returned by GET /api/projects/[id]. Money fields come from the chain only. */
export async function projectView(row: ProjectRow, viewer: Address | null) {
  const chain = row.chain_project_id ? await readProject(BigInt(row.chain_project_id)) : null;
  const access = await accessOf(row, chain, viewer);
  const party = isParty(access);
  const listingVisible = row.listing_status === "open";
  if (!party && !listingVisible && access !== "applicant") {
    // Private project: expose only that it exists + public on-chain facts.
    return {
      access,
      project: { id: row.id, title: "Private project", chainProjectId: row.chain_project_id },
      chain: chain ? serializeChain(chain) : null,
      private: true,
    };
  }

  let onchainTerms: TermsDocument | null = null;
  let termsCheck: { ok: boolean; mismatches: string[] } | null = null;
  if (chain) {
    const rev = await revisionForHash(row.id, chain.project.termsHash);
    onchainTerms = rev?.terms ?? null;
    termsCheck = rev
      ? compareTermsWithChain(rev.terms, chain.project, chain.milestones, chainSavingsTerms(chain))
      : { ok: false, mismatches: ["No stored terms document matches the on-chain terms hash"] };
  }
  const draftDiffers = chain ? row.terms_hash.toLowerCase() !== chain.project.termsHash.toLowerCase() : false;

  const revisions = party
    ? await query<{ revision: number; terms_hash: string; author: string; note: string; created_at: string }>(
        `select revision, terms_hash, author, note, created_at from escrowflow.terms_revisions where project_id = $1 order by revision desc`,
        [row.id],
      )
    : [];

  const timeline = await buildTimeline(row, party);
  const viewerRole = chain ? roleOf(chain.project, viewer) : access;

  return {
    access,
    viewerRole,
    private: false,
    project: {
      id: row.id,
      title: row.title,
      summary: row.summary,
      category: row.category,
      skills: row.skills,
      budgetWei: row.budget_wei,
      milestoneCount: row.milestone_count,
      finalDeadline: row.final_deadline,
      hiringMode: row.hiring_mode,
      listingStatus: row.listing_status,
      client: getAddress(row.client_address),
      freelancer: row.freelancer_address ? getAddress(row.freelancer_address) : null,
      chainProjectId: row.chain_project_id,
      createTxHash: row.create_tx_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    // Party-only: the full draft terms (latest saved) and the document the chain committed to.
    terms: party || listingVisible || access === "applicant" ? row.terms : null,
    termsHash: row.terms_hash,
    computedTermsHash: hashTerms(row.terms),
    onchainTerms: party ? onchainTerms : null,
    termsCheck,
    draftDiffers,
    revisions,
    chain: chain ? serializeChain(chain) : null,
    timeline,
  };
}

export function serializeChain(c: ChainSnapshot) {
  const ledger = ledgerOf(c.project);
  const rec = reconcile(c.project, c.milestones);
  return {
    id: c.id.toString(),
    blockNumber: c.blockNumber.toString(),
    escrow: c.escrow,
    version: c.version,
    project: c.project,
    milestones: c.milestones,
    yield: c.yield,
    ledger,
    reconciliation: rec,
  };
}
