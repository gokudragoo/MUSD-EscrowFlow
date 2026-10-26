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
import { ESCROW_ADDRESS, MUSD_ADDRESS, escrowFlowAbi, musdAbi } from "@/config/contracts";
import type { ChainMilestone, ChainProject } from "@/lib/escrow-state";
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
  };
}

export interface ChainSnapshot {
  id: bigint;
  project: ChainProject;
  milestones: ChainMilestone[];
  blockNumber: bigint;
}

/** Reads one project + its milestones from the contract (the source of truth). */
export async function readProject(id: bigint): Promise<ChainSnapshot | null> {
  const count = await serverClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "projectCount" });
  if (id < 1n || id > count) return null;
  const [project, milestones, blockNumber] = await Promise.all([
    serverClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "getProject", args: [id] }),
    serverClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "getMilestones", args: [id] }),
    serverClient.getBlockNumber(),
  ]);
  return {
    id,
    project: normalizeProject(project as unknown as Record<string, unknown>),
    milestones: (milestones as unknown as Record<string, unknown>[]).map(normalizeMilestone),
    blockNumber,
  };
}

/** Reads many projects in one multicall round-trip. */
export async function readProjects(ids: readonly bigint[]): Promise<ChainSnapshot[]> {
  if (ids.length === 0) return [];
  const blockNumber = await serverClient.getBlockNumber();
  const calls = ids.flatMap((id) => [
    { address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "getProject", args: [id] } as const,
    { address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "getMilestones", args: [id] } as const,
  ]);
  const res = await serverClient.multicall({ contracts: calls, allowFailure: false });
  return ids.map((id, i) => ({
    id,
    project: normalizeProject(res[i * 2] as unknown as Record<string, unknown>),
    milestones: (res[i * 2 + 1] as unknown as Record<string, unknown>[]).map(normalizeMilestone),
    blockNumber,
  }));
}

/** Project ids where `address` is client, or (current) freelancer, per the contract's own index. */
export async function projectIdsFor(address: Address): Promise<{ asClient: bigint[]; asFreelancer: bigint[] }> {
  const [asClient, asFreelancer] = await Promise.all([
    serverClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "projectsOfClient", args: [address] }),
    serverClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "projectsOfFreelancer", args: [address] }),
  ]);
  return { asClient: [...asClient], asFreelancer: [...asFreelancer] };
}

export interface DecodedEscrowEvent {
  eventName: string;
  args: Record<string, unknown>;
  logIndex: number;
  blockNumber: bigint;
  txHash: Hex;
  projectId: bigint;
  milestoneIndex: number | null;
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
    if (log.address.toLowerCase() !== ESCROW_ADDRESS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: escrowFlowAbi, data: log.data, topics: log.topics, strict: true });
      const args = (ev.args ?? {}) as Record<string, unknown>;
      out.push({
        eventName: ev.eventName,
        args,
        logIndex: Number(log.logIndex),
        blockNumber: BigInt(log.blockNumber ?? 0n),
        txHash: log.transactionHash as Hex,
        projectId: BigInt(args.projectId as bigint),
        milestoneIndex: args.index === undefined ? null : Number(args.index as bigint),
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
  const escrow = getAddress(ESCROW_ADDRESS);
  for (const e of events) {
    const a = e.args;
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
    }
  }
  return problems;
}

export async function getLatestBlock() {
  return serverClient.getBlockNumber();
}
