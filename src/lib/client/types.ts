import type { Address, Hex } from "viem";
import type { ChainMilestone, ChainProject, Ledger } from "@/lib/escrow-state";
import type { TermsDocument } from "@/lib/terms";

type Json<T> = { [K in keyof T]: T[K] extends bigint ? string : T[K] };

export interface ChainView {
  id: string;
  blockNumber: string;
  project: ChainProject;
  milestones: ChainMilestone[];
  ledger: Ledger;
  reconciliation: { ok: boolean; problems: string[] };
}

export interface ChainViewJson {
  id: string;
  blockNumber: string;
  project: Json<ChainProject>;
  milestones: Json<ChainMilestone>[];
  ledger: Json<Ledger>;
  reconciliation: { ok: boolean; problems: string[] };
}

const PROJECT_BIG: (keyof ChainProject)[] = ["createdAt", "fundedAt", "totalAmount", "fundedAmount", "releasedAmount", "refundedAmount"];
const MILESTONE_BIG: (keyof ChainMilestone)[] = [
  "amount",
  "deadline",
  "submittedAt",
  "changesRequestedAt",
  "disputedAt",
  "proposedFreelancerAmount",
  "releasedAmount",
  "refundedAmount",
];

/** Restores bigint fields of chain data serialised by the API as decimal strings. */
export function reviveChain(c: ChainViewJson | null | undefined): ChainView | null {
  if (!c) return null;
  const project = { ...c.project } as Record<string, unknown>;
  for (const k of PROJECT_BIG) project[k] = BigInt(project[k] as string);
  const milestones = c.milestones.map((m) => {
    const o = { ...m } as Record<string, unknown>;
    for (const k of MILESTONE_BIG) o[k] = BigInt(o[k] as string);
    return o as unknown as ChainMilestone;
  });
  const ledger = Object.fromEntries(Object.entries(c.ledger).map(([k, v]) => [k, BigInt(v as string)])) as unknown as Ledger;
  return { ...c, project: project as unknown as ChainProject, milestones, ledger };
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

export interface ProjectViewJson {
  access: "client" | "freelancer" | "arbiter" | "applicant" | "public";
  viewerRole?: string;
  private: boolean;
  project: {
    id: string;
    title: string;
    summary?: string;
    category?: string;
    skills?: string[];
    budgetWei?: string;
    milestoneCount?: number;
    finalDeadline?: string;
    hiringMode?: "direct" | "open";
    listingStatus?: "draft" | "open" | "closed";
    client?: Address;
    freelancer?: Address | null;
    chainProjectId: string | null;
    createTxHash?: string | null;
    createdAt?: string;
    updatedAt?: string;
  };
  terms?: TermsDocument | null;
  termsHash?: Hex;
  computedTermsHash?: Hex;
  onchainTerms?: TermsDocument | null;
  termsCheck?: { ok: boolean; mismatches: string[] } | null;
  draftDiffers?: boolean;
  revisions?: { revision: number; terms_hash: string; author: string; note: string; created_at: string }[];
  chain: ChainViewJson | null;
  timeline?: TimelineItem[];
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256?: string;
  url: string;
}

export interface Submission {
  id: string;
  milestoneIndex: number;
  description: string;
  links: string[];
  submissionHash: Hex;
  txHash: string | null;
  onchain: boolean;
  createdAt: string;
  attachments: Attachment[];
}

export interface Note {
  id: string;
  milestoneIndex: number | null;
  author: Address;
  kind: "comment" | "change_request" | "dispute" | "evidence";
  body: string;
  links: string[];
  noteHash: Hex | null;
  txHash: string | null;
  createdAt: string;
  attachments: Attachment[];
}

export interface Profile {
  address: Address;
  displayName: string;
  role: "client" | "freelancer" | "both";
  headline: string;
  bio: string;
  skills: string[];
  portfolioLinks: { label: string; url: string }[];
  socialLinks: { label: string; url: string }[];
  available: boolean;
  avatarUrl: string | null;
  updatedAt: string;
  notificationPrefs?: Record<string, boolean>;
}
