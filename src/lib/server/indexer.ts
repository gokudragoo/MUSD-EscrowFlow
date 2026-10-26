import "server-only";
import { getAddress, type Address, type Hex } from "viem";
import { ESCROW_ADDRESS, ESCROW_DEPLOY_BLOCK, isEscrowDeployed } from "@/config/contracts";
import { SUPPORTED_CHAIN_ID } from "@/config/chains";
import { formatMusd } from "@/lib/money";
import type { TermsDocument } from "@/lib/terms";
import { one, query } from "./db";
import {
  crossCheckTransfers,
  decodeEscrowLogs,
  decodeMusdTransfers,
  fetchReceipt,
  readProject,
  serverClient,
  type DecodedEscrowEvent,
} from "./chain";
import { notify } from "./records";

const SYNC_KEY = () => `escrowflow:${ESCROW_ADDRESS.toLowerCase()}`;
const CHUNK = 9_000n;

function jsonArgs(args: Record<string, unknown>) {
  return JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

const blockTimeCache = new Map<bigint, Date>();
async function blockTime(n: bigint): Promise<Date | null> {
  const cached = blockTimeCache.get(n);
  if (cached) return cached;
  try {
    const b = await serverClient.getBlock({ blockNumber: n });
    const d = new Date(Number(b.timestamp) * 1000);
    blockTimeCache.set(n, d);
    return d;
  } catch {
    return null;
  }
}

interface ProjectContext {
  client: Address;
  freelancer: Address;
  arbiter: Address;
  uuid: string | null;
  title: string;
  milestoneTitles: string[];
}

async function projectContext(chainId: bigint, cache: Map<string, ProjectContext | null>): Promise<ProjectContext | null> {
  const key = chainId.toString();
  if (cache.has(key)) return cache.get(key)!;
  const [snap, row] = await Promise.all([
    readProject(chainId).catch(() => null),
    one<{ id: string; title: string; terms: TermsDocument }>(
      `select id, title, terms from escrowflow.projects where chain_project_id = $1`,
      [key],
    ),
  ]);
  const ctx: ProjectContext | null = snap
    ? {
        client: snap.project.client,
        freelancer: snap.project.freelancer,
        arbiter: snap.project.arbiter,
        uuid: row?.id ?? null,
        title: row?.title ?? `Escrow #${key}`,
        milestoneTitles: row?.terms?.milestones?.map((m) => m.title) ?? [],
      }
    : null;
  cache.set(key, ctx);
  return ctx;
}

const ZERO = "0x0000000000000000000000000000000000000000";

async function notificationsFor(ev: DecodedEscrowEvent, ctx: ProjectContext) {
  const a = ev.args;
  const href = ctx.uuid ? `/projects/${ctx.uuid}` : `/escrow/${ev.projectId}`;
  const ms = ev.milestoneIndex != null ? (ctx.milestoneTitles[ev.milestoneIndex] ?? `Milestone ${ev.milestoneIndex + 1}`) : "";
  const msLabel = ev.milestoneIndex != null ? `M${ev.milestoneIndex + 1} · ${ms}` : "";
  const amt = (v: unknown) => `${formatMusd(BigInt(v as bigint))} MUSD`;
  const out: { to: string; kind: string; title: string; body: string }[] = [];
  const both = (kind: string, title: string, body: string) => {
    out.push({ to: ctx.client, kind, title, body }, { to: ctx.freelancer, kind, title, body });
  };
  const other = (by: unknown) => (getAddress(by as string) === ctx.client ? ctx.freelancer : ctx.client);

  switch (ev.eventName) {
    case "ProjectCreated":
      out.push({ to: ctx.freelancer, kind: "invitation", title: `New project invitation: ${ctx.title}`, body: "Review the terms and accept them to move to funding." });
      break;
    case "TermsSet":
      if (Number(a.version) > 1) {
        out.push({ to: ctx.freelancer, kind: "terms", title: `Terms updated to version ${a.version}`, body: `${ctx.title}: the client changed the terms. Your earlier acceptance no longer applies.` });
      }
      break;
    case "TermsAccepted":
      out.push({ to: ctx.client, kind: "terms", title: `Terms accepted: ${ctx.title}`, body: `The freelancer accepted version ${a.version}. You can now fund the escrow.` });
      break;
    case "AcceptanceRevoked":
      out.push({ to: ctx.client, kind: "terms", title: `Acceptance withdrawn: ${ctx.title}`, body: "The freelancer withdrew their acceptance before funding." });
      break;
    case "ProjectFunded":
      out.push({ to: ctx.freelancer, kind: "funding", title: `Escrow funded: ${amt(a.amount)}`, body: `${ctx.title} is fully funded on-chain. Work can start.` });
      out.push({ to: ctx.client, kind: "funding", title: `Funding confirmed: ${amt(a.amount)}`, body: `Your deposit for ${ctx.title} is held by the EscrowFlow contract.` });
      break;
    case "MilestoneSubmitted":
      out.push({
        to: ctx.client,
        kind: "review",
        title: `Review requested: ${msLabel}`,
        body: `Revision ${a.revision} submitted. Review period ends ${new Date(Number(a.reviewDeadline) * 1000).toUTCString()}.`,
      });
      break;
    case "ChangesRequested":
      out.push({ to: ctx.freelancer, kind: "review", title: `Changes requested: ${msLabel}`, body: `${ctx.title}: see the client's notes and resubmit.` });
      break;
    case "MilestoneReleased":
      out.push({
        to: ctx.freelancer,
        kind: "payment",
        title: `Payment received: ${amt(a.amount)}`,
        body: `${msLabel} was ${Number(a.kind) === 1 ? "claimed after the review period" : "approved and released"}.`,
      });
      out.push({ to: ctx.client, kind: "payment", title: `Payment released: ${amt(a.amount)}`, body: `${msLabel} on ${ctx.title}.` });
      break;
    case "MilestoneRefunded":
      both("refund", `Refunded to client: ${amt(a.amount)}`, `${msLabel} (${Number(a.kind) === 0 ? "deadline reclaim" : "mutual cancellation"}).`);
      break;
    case "DisputeOpened":
      out.push({ to: other(a.by), kind: "dispute", title: `Dispute opened: ${msLabel}`, body: `${ctx.title}: funds for this milestone are frozen until it is resolved.` });
      if (ctx.arbiter !== ZERO) out.push({ to: ctx.arbiter, kind: "dispute", title: `You are the arbiter for a dispute`, body: `${ctx.title} · ${msLabel}` });
      break;
    case "SettlementProposed":
      out.push({ to: other(a.by), kind: "dispute", title: `Settlement proposed: ${msLabel}`, body: `Proposed split: ${amt(a.freelancerAmount)} to the freelancer.` });
      break;
    case "DisputeResolved":
      both("dispute", `Dispute resolved: ${msLabel}`, `${amt(a.freelancerAmount)} to the freelancer, ${amt(a.clientAmount)} to the client (${Number(a.kind) === 1 ? "arbiter ruling" : "mutual settlement"}).`);
      break;
    case "DisputeWithdrawn":
      out.push({ to: other(a.by), kind: "dispute", title: `Dispute withdrawn: ${msLabel}`, body: "The milestone returned to its previous state with a fresh review window." });
      break;
    case "CancellationProposed":
      out.push({ to: other(a.by), kind: "cancellation", title: `Cancellation proposed: ${ctx.title}`, body: "If you accept, unpaid and undisputed milestones are refunded to the client." });
      break;
    case "ProjectCancelled":
      both("cancellation", `Project cancelled: ${ctx.title}`, a.wasFunded ? `${amt(a.refundedAmount)} refunded to the client.` : "Cancelled before funding. No funds moved.");
      break;
    case "ProjectClosed":
      if (Number(a.finalStatus) === 4) both("completed", `Project completed: ${ctx.title}`, "Every milestone is settled on-chain.");
      break;
  }
  for (const n of out) {
    await notify({
      recipient: n.to,
      kind: n.kind,
      title: n.title,
      body: n.body,
      href,
      source: "chain",
      txHash: ev.txHash,
      dedupeKey: `chain:${ev.txHash}:${ev.logIndex}:${n.to.toLowerCase()}`,
    });
  }
}

/** Stores decoded events (idempotent on tx_hash+log_index) and notifies once per new event. */
export async function ingestEvents(events: DecodedEscrowEvent[]) {
  const cache = new Map<string, ProjectContext | null>();
  let inserted = 0;
  for (const ev of events) {
    const time = await blockTime(ev.blockNumber);
    const row = await one<{ id: string }>(
      `insert into escrowflow.chain_events
         (chain_id, contract_address, block_number, block_time, tx_hash, log_index, event_name, chain_project_id, milestone_index, args)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (tx_hash, log_index) do nothing returning id`,
      [
        SUPPORTED_CHAIN_ID,
        ESCROW_ADDRESS.toLowerCase(),
        ev.blockNumber.toString(),
        time,
        ev.txHash.toLowerCase(),
        ev.logIndex,
        ev.eventName,
        ev.projectId.toString(),
        ev.milestoneIndex,
        jsonArgs(ev.args),
      ],
    );
    if (row) {
      inserted++;
      const ctx = await projectContext(ev.projectId, cache);
      if (ctx) await notificationsFor(ev, ctx).catch((e) => console.error("[indexer] notify failed", e));
    }
  }
  return inserted;
}

export type TxVerification =
  | { status: "confirmed"; blockNumber: bigint; events: DecodedEscrowEvent[]; problems: string[] }
  | { status: "pending" }
  | { status: "failed"; blockNumber: bigint }
  | { status: "rejected"; reason: string };

/**
 * Server-side verification of an EscrowFlow transaction: receipt exists and succeeded, it was sent
 * to the EscrowFlow contract, it emitted EscrowFlow events, and every money-moving event is matched
 * by an exact MUSD Transfer log from the official MUSD contract. Then the events are stored.
 */
export async function verifyEscrowTx(hash: Hex, opts: { ingest?: boolean } = {}): Promise<TxVerification> {
  if (!isEscrowDeployed()) return { status: "rejected", reason: "Escrow contract is not configured" };
  const receipt = await fetchReceipt(hash);
  if (!receipt) return { status: "pending" };
  if (receipt.status !== "success") return { status: "failed", blockNumber: receipt.blockNumber };
  if (!receipt.to || receipt.to.toLowerCase() !== ESCROW_ADDRESS.toLowerCase()) {
    return { status: "rejected", reason: "Transaction was not sent to the EscrowFlow contract" };
  }
  const events = decodeEscrowLogs(receipt.logs);
  if (events.length === 0) return { status: "rejected", reason: "Transaction emitted no EscrowFlow events" };
  const transfers = decodeMusdTransfers(receipt.logs);
  const parties = new Map<string, { client: Address; freelancer: Address }>();
  for (const id of new Set(events.map((e) => e.projectId))) {
    const snap = await readProject(id);
    if (snap) parties.set(id.toString(), { client: snap.project.client, freelancer: snap.project.freelancer });
  }
  const problems = crossCheckTransfers(events, transfers, parties);
  if (problems.length === 0 && opts.ingest !== false) await ingestEvents(events);
  return { status: "confirmed", blockNumber: receipt.blockNumber, events, problems };
}

/** Pulls EscrowFlow logs since the last synced block (≤ maxChunks × 9k blocks per call). */
export async function syncChainEvents(maxChunks = 8): Promise<{ from: bigint; to: bigint; inserted: number; caughtUp: boolean }> {
  if (!isEscrowDeployed()) return { from: 0n, to: 0n, inserted: 0, caughtUp: true };
  const state = await one<{ last_block: string }>(`select last_block from escrowflow.sync_state where key = $1`, [SYNC_KEY()]);
  const latest = await serverClient.getBlockNumber();
  let from = state ? BigInt(state.last_block) + 1n : ESCROW_DEPLOY_BLOCK;
  const start = from;
  let inserted = 0;
  let chunks = 0;
  while (from <= latest && chunks < maxChunks) {
    const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
    const logs = await serverClient.getLogs({ address: ESCROW_ADDRESS, fromBlock: from, toBlock: to });
    const events = decodeEscrowLogs(logs);
    if (events.length) inserted += await ingestEvents(events);
    await query(
      `insert into escrowflow.sync_state (key, last_block, updated_at) values ($1, $2, now())
       on conflict (key) do update set last_block = greatest(escrowflow.sync_state.last_block, excluded.last_block), updated_at = now()`,
      [SYNC_KEY(), to.toString()],
    );
    from = to + 1n;
    chunks++;
  }
  return { from: start, to: from - 1n, inserted, caughtUp: from > latest };
}

let inflight: Promise<unknown> | null = null;

/** Keeps the event cache fresh while people use the app (no frequent cron on Hobby). */
export async function syncIfStale(maxAgeMs = 12_000) {
  try {
    const state = await one<{ updated_at: string }>(`select updated_at from escrowflow.sync_state where key = $1`, [SYNC_KEY()]);
    if (state && Date.now() - new Date(state.updated_at).getTime() < maxAgeMs) return;
    if (!inflight) inflight = syncChainEvents().finally(() => (inflight = null));
    await inflight;
  } catch (e) {
    console.error("[indexer] sync failed", e);
  }
}
