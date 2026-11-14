import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { canonicalHash } from "./canonical";
import { sumWei } from "./money";

export const TERMS_SCHEMA = "escrowflow.terms/v1" as const;
export const SUBMISSION_SCHEMA = "escrowflow.submission/v1" as const;
export const NOTE_SCHEMA = "escrowflow.note/v1" as const;

export interface TermsMilestone {
  title: string;
  description: string;
  deliverables: string[];
  acceptanceCriteria: string[];
  /** wei, decimal string */
  amount: string;
  /** unix seconds */
  deadline: number;
  reviewPeriodSeconds: number;
}

export interface TermsRules {
  autoRelease: boolean;
  deadlineReclaim: boolean;
  reclaimGracePeriodSeconds: number;
  arbiter: Address | null;
  cancellationTerms: string;
  disputeTerms: string;
  /**
   * Optional (v2 escrows): park the held budget in Mezo's sMUSD savings vault while work is in
   * progress and split the yield. Absent on older documents, so their hashes never change.
   */
  savings?: TermsSavings;
}

export interface TermsSavings {
  enabled: boolean;
  /** Freelancer's share of the savings yield in basis points (0–10 000); the client gets the rest. */
  freelancerShareBps: number;
}

export const savingsOf = (doc: Pick<TermsDocument, "rules">): TermsSavings =>
  doc.rules.savings?.enabled ? { enabled: true, freelancerShareBps: doc.rules.savings.freelancerShareBps } : { enabled: false, freelancerShareBps: 0 };

/** The agreement document. Its canonical keccak256 is the on-chain `termsHash`. */
export interface TermsDocument {
  schema: typeof TERMS_SCHEMA;
  title: string;
  summary: string;
  description: string;
  category: string;
  client: Address;
  freelancer: Address;
  chainId: number;
  token: { address: Address; symbol: string; decimals: number };
  /** wei, decimal string */
  totalAmount: string;
  startDate: string | null;
  milestones: TermsMilestone[];
  rules: TermsRules;
  references: string[];
}

export function hashTerms(doc: TermsDocument): Hex {
  return canonicalHash(doc);
}

/** Arguments for EscrowFlow.createProject / updateTerms (ProjectParams tuple). */
export interface ProjectParamsArg {
  freelancer: Address;
  arbiter: Address;
  termsHash: Hex;
  autoRelease: boolean;
  deadlineReclaim: boolean;
  reclaimGracePeriod: number;
  amounts: bigint[];
  deadlines: bigint[];
  reviewPeriods: number[];
  yieldEnabled: boolean;
  freelancerYieldBps: number;
}

export function termsToParams(doc: TermsDocument): ProjectParamsArg {
  return {
    freelancer: getAddress(doc.freelancer),
    arbiter: doc.rules.arbiter ? getAddress(doc.rules.arbiter) : zeroAddress,
    termsHash: hashTerms(doc),
    autoRelease: doc.rules.autoRelease,
    deadlineReclaim: doc.rules.deadlineReclaim,
    reclaimGracePeriod: doc.rules.reclaimGracePeriodSeconds,
    amounts: doc.milestones.map((m) => BigInt(m.amount)),
    deadlines: doc.milestones.map((m) => BigInt(m.deadline)),
    reviewPeriods: doc.milestones.map((m) => m.reviewPeriodSeconds),
    yieldEnabled: savingsOf(doc).enabled,
    freelancerYieldBps: savingsOf(doc).freelancerShareBps,
  };
}

/** Internal consistency checks of a terms document (independent of the chain). */
export function validateTermsDocument(doc: TermsDocument): string[] {
  const problems: string[] = [];
  if (doc.schema !== TERMS_SCHEMA) problems.push("Unknown terms schema");
  if (!isAddress(doc.client)) problems.push("Client address is invalid");
  if (!isAddress(doc.freelancer)) problems.push("Freelancer address is invalid");
  if (isAddress(doc.client) && isAddress(doc.freelancer) && getAddress(doc.client) === getAddress(doc.freelancer)) {
    problems.push("Client and freelancer must be different wallets");
  }
  if (doc.rules.arbiter) {
    if (!isAddress(doc.rules.arbiter)) problems.push("Arbiter address is invalid");
    else {
      const a = getAddress(doc.rules.arbiter);
      if (a === getAddress(doc.client) || a === getAddress(doc.freelancer)) {
        problems.push("Arbiter must be a third party");
      }
    }
  }
  if (doc.milestones.length === 0 || doc.milestones.length > 20) problems.push("1 to 20 milestones are required");
  let amounts: bigint[] = [];
  try {
    amounts = doc.milestones.map((m) => BigInt(m.amount));
  } catch {
    problems.push("Milestone amounts must be integer base units");
  }
  if (amounts.some((a) => a <= 0n)) problems.push("Every milestone needs an amount above zero");
  const sv = doc.rules.savings;
  if (sv && (!Number.isInteger(sv.freelancerShareBps) || sv.freelancerShareBps < 0 || sv.freelancerShareBps > 10_000)) {
    problems.push("Savings yield split must be between 0 and 100%");
  }
  try {
    if (sumWei(amounts) !== BigInt(doc.totalAmount)) problems.push("Milestone amounts do not add up to the budget");
  } catch {
    problems.push("Total amount is invalid");
  }
  return problems;
}

export interface ChainProjectLike {
  freelancer: Address;
  arbiter: Address;
  termsHash: Hex;
  autoRelease: boolean;
  deadlineReclaim: boolean;
  reclaimGracePeriod: number;
  totalAmount: bigint;
  milestoneCount: number;
  client: Address;
}

export interface ChainMilestoneLike {
  amount: bigint;
  deadline: bigint;
  reviewPeriod: number;
}

/**
 * Proves the off-chain document is exactly what the contract enforces: the hash matches and
 * every economic parameter (amounts, deadlines, review periods, arbiter, rules) is identical.
 */
export function compareTermsWithChain(
  doc: TermsDocument,
  project: ChainProjectLike,
  milestones: readonly ChainMilestoneLike[],
  /** v2 savings terms from getYield(); omit for v1 escrows (which have no savings option). */
  chainYield?: { enabled: boolean; freelancerBps: number } | null,
): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!eq(hashTerms(doc), project.termsHash)) mismatches.push("Terms hash differs from the on-chain hash");
  if (!eq(doc.client, project.client)) mismatches.push("Client differs");
  if (!eq(doc.freelancer, project.freelancer)) mismatches.push("Freelancer differs");
  if (!eq(doc.rules.arbiter ?? zeroAddress, project.arbiter)) mismatches.push("Arbiter differs");
  if (doc.rules.autoRelease !== project.autoRelease) mismatches.push("Auto-release rule differs");
  if (doc.rules.deadlineReclaim !== project.deadlineReclaim) mismatches.push("Deadline reclaim rule differs");
  if (doc.rules.reclaimGracePeriodSeconds !== Number(project.reclaimGracePeriod)) mismatches.push("Grace period differs");
  if (BigInt(doc.totalAmount) !== project.totalAmount) mismatches.push("Total amount differs");
  const sv = savingsOf(doc);
  if (chainYield) {
    if (sv.enabled !== chainYield.enabled) mismatches.push("Savings (sMUSD) rule differs");
    else if (sv.enabled && sv.freelancerShareBps !== Number(chainYield.freelancerBps)) mismatches.push("Savings yield split differs");
  } else if (sv.enabled) {
    mismatches.push("The document enables sMUSD savings but the escrow does not report it");
  }
  if (doc.milestones.length !== Number(project.milestoneCount) || doc.milestones.length !== milestones.length) {
    mismatches.push("Milestone count differs");
  } else {
    doc.milestones.forEach((m, i) => {
      const c = milestones[i];
      if (BigInt(m.amount) !== c.amount) mismatches.push(`Milestone ${i + 1} amount differs`);
      if (BigInt(m.deadline) !== BigInt(c.deadline)) mismatches.push(`Milestone ${i + 1} deadline differs`);
      if (m.reviewPeriodSeconds !== Number(c.reviewPeriod)) mismatches.push(`Milestone ${i + 1} review period differs`);
    });
  }
  return { ok: mismatches.length === 0, mismatches };
}

export interface SubmissionRecord {
  schema: typeof SUBMISSION_SCHEMA;
  chainProjectId: string;
  milestoneIndex: number;
  freelancer: Address;
  description: string;
  links: string[];
  attachments: { name: string; mime: string; size: number; sha256: string }[];
  createdAt: string;
}

export function hashSubmission(rec: SubmissionRecord): Hex {
  return canonicalHash(rec);
}

/** A change-request reason / dispute reason note committed on-chain by hash. */
export interface NoteRecord {
  schema: typeof NOTE_SCHEMA;
  kind: "change_request" | "dispute";
  chainProjectId: string;
  milestoneIndex: number;
  author: Address;
  body: string;
  createdAt: string;
}

export function hashNote(rec: NoteRecord): Hex {
  return canonicalHash(rec);
}
