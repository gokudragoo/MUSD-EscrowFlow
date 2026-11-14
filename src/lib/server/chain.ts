import "server-only";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { mezoTestnet } from "@/config/chains";
import { ESCROW_ID_OFFSET, ESCROW_REGISTRIES, MUSD_ADDRESS, escrowForId, musdAbi } from "@/config/contracts";
import type { ChainMilestone, ChainProject, ChainYield } from "@/lib/escrow-state";
import { serverEnv } from "./env";

export const serverClient = createPublicClient({
  chain: mezoTestnet,
  transport: http(serverEnv.rpcUrl(), { retryCount: 3, retryDelay: 400, timeout: 15_000 }),
  batch: { multicall: { wait: 16 } },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalizeProject(raw: Record<string, unknown>): ChainProject {
  return {
    client: getAddress(raw.client as string),
    status: Number(raw.status),
    autoRelease: Boolean(raw.autoRelease),
    deadlineReclaim: Boolean(raw.deadlineReclaim),
    cancelled: Boolean(raw.cancelled),
    termsVersion: Number(raw.termsVersion),
    reclaimGracePeriod: Number(raw.reclaimGracePeriod),
    freelancer: getAddress(raw.freelancer as string),
    acceptedVersion: Number(raw.acceptedVersion),
    milestoneCount: Number(raw.milestoneCount),
    openDisputes: Number(raw.openDisputes),
    arbiter: getAddress(raw.arbiter as string),
    createdAt: BigInt(raw.createdAt as bigint),
    cancelProposer: getAddress(raw.cancelProposer as string),
    fundedAt: BigInt(raw.fundedAt as bigint),
    termsHash: raw.termsHash as Hex,
    totalAmount: BigInt(raw.totalAmount as bigint),
    fundedAmount: BigInt(raw.fundedAmount as bigint),
    releasedAmount: BigInt(raw.releasedAmount as bigint),
    refundedAmount: BigInt(raw.refundedAmount as bigint),
  };
}

function normalizeMilestone(raw: Record<string, unknown>): ChainMilestone {
  return {
    amount: BigInt(raw.amount as bigint),
    deadline: BigInt(raw.deadline as bigint),
    reviewPeriod: Number(raw.reviewPeriod),
    status: Number(raw.status),
    statusBeforeDispute: Number(raw.statusBeforeDispute),
    revision: Number(raw.revision),
    submittedAt: BigInt(raw.submittedAt as bigint),
    changesRequestedAt: BigInt(raw.changesRequestedAt as bigint),
    disputedAt: BigInt(raw.disputedAt as bigint),
    disputeInitiator: getAddress(raw.disputeInitiator as string),
    settlementProposer: getAddress(raw.settlementProposer as string),
    proposedFreelancerAmount: BigInt(raw.proposedFreelancerAmount as bigint),
    submissionHash: raw.submissionHash as Hex,
    releasedAmount: BigInt(raw.releasedAmount as bigint),
    refundedAmount: BigInt(raw.refundedAmount as bigint),
    pausedFor: BigInt((raw.pausedFor as bigint | undefined) ?? 0n),
  };
}

function normalizeYield(raw: Record<string, unknown> | null | undefined): ChainYield | null {
  if (!raw) return null;
  return {
    enabled: Boolean(raw.enabled),
    freelancerBps: Number(raw.freelancerBps),
    principal: BigInt(raw.principal as bigint),
    accrued: BigInt(raw.accrued as bigint),
    paid: BigInt(raw.paid as bigint),
  };
}

export interface ChainSnapshot {
  id: bigint;
  /** Registry that holds this escrow (v2 for new escrows, v1 for the legacy ones). */
  escrow: Address;
  version: 1 | 2;
  project: ChainProject;
  milestones: ChainMilestone[];
  /** v2 only: sMUSD savings state; null on v1 or when the read failed. */
  yield: ChainYield | null;
  blockNumber: bigint;
}

/** First and last id the registry has assigned. */
async function idRange(target: ReturnType<typeof escrowForId>) {
  const count = await serverClient.readContract({ address: target.address, abi: target.abi, functionName: "projectCount" });
  const first = target.version === 2 ? ESCROW_ID_OFFSET + 1n : 1n;
  return { first, last: first + count - 1n };
}

/** Caps how many escrows one wallet view loads (anyone can create escrows naming any freelancer). */
export const MAX_PROJECTS_PER_VIEW = 60;

/** Reads one project + its milestones (+ v2 savings state) from the contract (the source of truth). */
export async function readProject(id: bigint): Promise<ChainSnapshot | null> {
  const target = escrowForId(id);
  const { first, last } = await idRange(target);
  if (id < first || id > last) return null;
  const [project, milestones, yieldRaw, blockNumber] = await Promise.all([
    serverClient.readContract({ address: target.address, abi: target.abi, functionName: "getProject", args: [id] }),
    serverClient.readContract({ address: target.address, abi: target.abi, functionName: "getMilestones", args: [id] }),
    target.version === 2
      ? serverClient.readContract({ address: target.address, abi: target.abi, functionName: "getYield", args: [id] }).catch(() => null)
      : Promise.resolve(null),
    serverClient.getBlockNumber(),
  ]);
  return {
    id,
    escrow: target.address,
    version: target.version,
    project: normalizeProject(project as unknown as Record<string, unknown>),
    milestones: (milestones as unknown as Record<string, unknown>[]).map(normalizeMilestone),
    yield: normalizeYield(yieldRaw as unknown as Record<string, unknown> | null),
    blockNumber,
  };
}

/** Reads many projects in one multicall round-trip. Unreadable ids are skipped, never fatal. */
export async function readProjects(ids: readonly bigint[], limit = MAX_PROJECTS_PER_VIEW): Promise<ChainSnapshot[]> {
  if (ids.length === 0) return [];
  const list = [...new Set(ids)].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)).slice(0, limit);
  const blockNumber = await serverClient.getBlockNumber();
  const calls = list.flatMap((id) => {
    const t = escrowForId(id);
    return [
      { address: t.address, abi: t.abi, functionName: "getProject", args: [id] },
      { address: t.address, abi: t.abi, functionName: "getMilestones", args: [id] },
      // v1 has no getYield: repeat getProject as a harmless placeholder and ignore it.
      { address: t.address, abi: t.abi, functionName: t.version === 2 ? "getYield" : "getProject", args: [id] },
    ];
  });
  const res = (await serverClient.multicall({ contracts: calls as never, allowFailure: true })) as { status: string; result?: unknown }[];
  const out: ChainSnapshot[] = [];
  list.forEach((id, i) => {
    const [p, m, y] = [res[i * 3], res[i * 3 + 1], res[i * 3 + 2]];
    if (p?.status !== "success" || m?.status !== "success") return;
    const t = escrowForId(id);
    out.push({
      id,
      escrow: t.address,
      version: t.version,
      project: normalizeProject(p.result as Record<string, unknown>),
      milestones: (m.result as Record<string, unknown>[]).map(normalizeMilestone),
      yield: t.version === 2 && y?.status === "success" ? normalizeYield(y.result as Record<string, unknown>) : null,
      blockNumber,
    });
  });
  return out;
}

/** Project ids where `address` is client, or (current) freelancer, per every registry's own index. */
export async function projectIdsFor(address: Address): Promise<{ asClient: bigint[]; asFreelancer: bigint[] }> {
  const asClient: bigint[] = [];
  const asFreelancer: bigint[] = [];
  await Promise.all(
    ESCROW_REGISTRIES.map(async (r) => {
      const [c, f] = await Promise.all([
        serverClient.readContract({ address: r.address, abi: r.abi, functionName: "projectsOfClient", args: [address] }).catch(() => [] as readonly bigint[]),
        serverClient.readContract({ address: r.address, abi: r.abi, functionName: "projectsOfFreelancer", args: [address] }).catch(() => [] as readonly bigint[]),
      ]);
      asClient.push(...c);
      asFreelancer.push(...f);
    }),
  );
  return { asClient, asFreelancer };
}

export interface DecodedEscrowEvent {
  eventName: string;
  args: Record<string, unknown>;
  logIndex: number;
  blockNumber: bigint;
  txHash: Hex;
  projectId: bigint;
  milestoneIndex: number | null;
  /** The registry that emitted the event. */
  contract: Address;
}

export interface MusdTransfer {
  from: Address;
  to: Address;
  value: bigint;
  logIndex: number;
}

export function decodeEscrowLogs(logs: readonly Log[]): DecodedEscrowEvent[] {
  const out: DecodedEscrowEvent[] = [];
  for (const log of logs) {
    const registry = ESCROW_REGISTRIES.find((r) => r.address.toLowerCase() === log.address.toLowerCase());
    if (!registry) continue;
    try {
      const ev = decodeEventLog({ abi: registry.abi, data: log.data, topics: log.topics, strict: true });
      const args = (ev.args ?? {}) as Record<string, unknown>;
      out.push({
        eventName: ev.eventName,
        args,
        logIndex: Number(log.logIndex),
        blockNumber: BigInt(log.blockNumber ?? 0n),
        txHash: log.transactionHash as Hex,
        projectId: BigInt(args.projectId as bigint),
        milestoneIndex: args.index === undefined ? null : Number(args.index as bigint),
        contract: getAddress(log.address),
      });
    } catch {
      // not an EscrowFlow event we know
    }
  }
  return out;
}

export function decodeMusdTransfers(logs: readonly Log[]): MusdTransfer[] {
  const out: MusdTransfer[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== MUSD_ADDRESS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: musdAbi, data: log.data, topics: log.topics, strict: true });
      if (ev.eventName !== "Transfer") continue;
      const a = ev.args as { from: Address; to: Address; value: bigint };
      out.push({ from: getAddress(a.from), to: getAddress(a.to), value: a.value, logIndex: Number(log.logIndex) });
    } catch {
      // ignore
    }
  }
  return out;
}

/** Fetches a receipt with retries (RPC lag / not yet mined). Returns null if still unknown. */
export async function fetchReceipt(hash: Hex, attempts = 6): Promise<TransactionReceipt | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await serverClient.getTransactionReceipt({ hash });
    } catch {
      await sleep(800 + i * 700);
    }
  }
  return null;
}

/**
 * For every money-moving escrow event, require the matching MUSD Transfer log in the same receipt
 * (from the official MUSD contract, exact from/to/value). Returns a list of problems (empty = ok).
 */
export function crossCheckTransfers(events: DecodedEscrowEvent[], transfers: MusdTransfer[], parties: Map<string, { client: Address; freelancer: Address }>): string[] {
  const problems: string[] = [];
  const pool = [...transfers];
  const take = (from: Address, to: Address, value: bigint) => {
    const i = pool.findIndex((t) => t.from === getAddress(from) && t.to === getAddress(to) && t.value === value);
    if (i === -1) return false;
    pool.splice(i, 1);
    return true;
  };
  for (const e of events) {
    const a = e.args;
    const escrow = e.contract;
    const party = parties.get(e.projectId.toString());
    switch (e.eventName) {
      case "ProjectFunded":
        if (!take(a.client as Address, escrow, a.amount as bigint)) problems.push(`No matching MUSD deposit for project ${e.projectId}`);
        break;
      case "MilestoneReleased":
        if (!take(escrow, a.freelancer as Address, a.amount as bigint)) problems.push(`No matching MUSD release transfer for project ${e.projectId}`);
        break;
      case "MilestoneRefunded":
        // Mutual cancellation refunds all milestones in one transfer (checked on ProjectCancelled).
        if (Number(a.kind) === 0 && !take(escrow, a.client as Address, a.amount as bigint)) {
          problems.push(`No matching MUSD refund transfer for project ${e.projectId}`);
        }
        break;
      case "ProjectCancelled":
        if ((a.refundedAmount as bigint) > 0n && party && !take(escrow, party.client, a.refundedAmount as bigint)) {
          problems.push(`No matching MUSD cancellation refund for project ${e.projectId}`);
        }
        break;
      case "DisputeResolved":
        if (party) {
          if ((a.freelancerAmount as bigint) > 0n && !take(escrow, party.freelancer, a.freelancerAmount as bigint)) {
            problems.push(`No matching MUSD settlement transfer to the freelancer for project ${e.projectId}`);
          }
          if ((a.clientAmount as bigint) > 0n && !take(escrow, party.client, a.clientAmount as bigint)) {
            problems.push(`No matching MUSD settlement transfer to the client for project ${e.projectId}`);
          }
        }
        break;
      case "YieldDistributed":
        if ((a.freelancerAmount as bigint) > 0n && !take(escrow, a.freelancer as Address, a.freelancerAmount as bigint)) {
          problems.push(`No matching MUSD yield transfer to the freelancer for project ${e.projectId}`);
        }
        if ((a.clientAmount as bigint) > 0n && !take(escrow, a.client as Address, a.clientAmount as bigint)) {
          problems.push(`No matching MUSD yield transfer to the client for project ${e.projectId}`);
        }
        break;
    }
  }
  return problems;
}

export async function getLatestBlock() {
  return serverClient.getBlockNumber();
}
