import { z } from "zod";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { checkMilestoneSum, tryParseMusd, toDecimalString } from "./money";
import { TERMS_SCHEMA, type TermsDocument } from "./terms";
import { MUSD_ADDRESS } from "@/config/contracts";
import { SUPPORTED_CHAIN_ID } from "@/config/chains";

export const CATEGORIES = [
  "Development",
  "Design",
  "UI/UX",
  "Writing",
  "Video",
  "Marketing",
  "Web3 & community",
  "Other",
] as const;

export const MIN_REVIEW_SECONDS = 60;
export const MAX_REVIEW_SECONDS = 90 * 86_400;
export const MAX_GRACE_SECONDS = 90 * 86_400;
export const MAX_HORIZON_SECONDS = 5 * 365 * 86_400;

export const addressSchema = z
  .string()
  .trim()
  .refine((v) => isAddress(v, { strict: false }), "Enter a valid 0x wallet address")
  .transform((v) => getAddress(v));

const urlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Links must start with https://");

export const amountSchema = z
  .string()
  .trim()
  .refine((v) => tryParseMusd(v) !== null, "Enter an amount like 40 or 40.50")
  .refine((v) => (tryParseMusd(v) ?? 0n) > 0n, "Amount must be above zero");

export const milestoneInputSchema = z.object({
  title: z.string().trim().min(2, "Give the milestone a title").max(120),
  description: z.string().trim().max(2000).default(""),
  deliverables: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(300)).min(1, "Add at least one acceptance criterion").max(20),
  amount: amountSchema,
  deadline: z.number().int().positive(),
  reviewPeriodSeconds: z.number().int().min(MIN_REVIEW_SECONDS).max(MAX_REVIEW_SECONDS),
});

export const rulesInputSchema = z.object({
  autoRelease: z.boolean(),
  deadlineReclaim: z.boolean(),
  reclaimGracePeriodSeconds: z.number().int().min(0).max(MAX_GRACE_SECONDS),
  arbiter: addressSchema.nullable(),
  cancellationTerms: z.string().trim().max(2000).default(""),
  disputeTerms: z.string().trim().max(2000).default(""),
});

export const draftInputSchema = z
  .object({
    title: z.string().trim().min(3, "Title needs at least 3 characters").max(120),
    summary: z.string().trim().max(280).default(""),
    description: z.string().trim().min(10, "Describe the project in a sentence or two").max(8000),
    category: z.enum(CATEGORIES),
    skills: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    budget: amountSchema,
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    hiringMode: z.enum(["direct", "open"]),
    freelancer: addressSchema.nullable(),
    milestones: z.array(milestoneInputSchema).min(1, "Add at least one milestone").max(20, "At most 20 milestones"),
    rules: rulesInputSchema,
    references: z.array(urlSchema).max(10).default([]),
  })
  .superRefine((d, ctx) => {
    const budget = tryParseMusd(d.budget) ?? 0n;
    const amounts = d.milestones.map((m) => tryParseMusd(m.amount) ?? 0n);
    const sum = checkMilestoneSum(budget, amounts);
    if (!sum.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["milestones"],
        message:
          sum.difference > 0n
            ? `Milestones add up to ${toDecimalString(sum.total)} MUSD — ${toDecimalString(sum.difference)} MUSD of the budget is unallocated`
            : `Milestones add up to ${toDecimalString(sum.total)} MUSD — ${toDecimalString(-sum.difference)} MUSD over the budget`,
      });
    }
    if (d.hiringMode === "direct" && !d.freelancer) {
      ctx.addIssue({ code: "custom", path: ["freelancer"], message: "Enter the freelancer's wallet address" });
    }
    if (d.freelancer && d.rules.arbiter && d.freelancer === d.rules.arbiter) {
      ctx.addIssue({ code: "custom", path: ["rules", "arbiter"], message: "The arbiter must be a third party" });
    }
    const now = Math.floor(Date.now() / 1000);
    d.milestones.forEach((m, i) => {
      if (m.deadline <= now) ctx.addIssue({ code: "custom", path: ["milestones", i, "deadline"], message: "Deadline must be in the future" });
      if (m.deadline > now + MAX_HORIZON_SECONDS) {
        ctx.addIssue({ code: "custom", path: ["milestones", i, "deadline"], message: "Deadline is too far in the future" });
      }
    });
  });

export type DraftInput = z.infer<typeof draftInputSchema>;

/** Builds the canonical terms document from a validated draft. Open listings use a zero freelancer until selection. */
export function buildTermsDocument(d: DraftInput, client: Address, freelancerOverride?: Address | null): TermsDocument {
  const freelancer = freelancerOverride ?? d.freelancer ?? zeroAddress;
  return {
    schema: TERMS_SCHEMA,
    title: d.title,
    summary: d.summary,
    description: d.description,
    category: d.category,
    client: getAddress(client),
    freelancer: getAddress(freelancer),
    chainId: SUPPORTED_CHAIN_ID,
    token: { address: MUSD_ADDRESS, symbol: "MUSD", decimals: 18 },
    totalAmount: (tryParseMusd(d.budget) ?? 0n).toString(),
    startDate: d.startDate,
    milestones: d.milestones.map((m) => ({
      title: m.title,
      description: m.description,
      deliverables: m.deliverables,
      acceptanceCriteria: m.acceptanceCriteria,
      amount: (tryParseMusd(m.amount) ?? 0n).toString(),
      deadline: m.deadline,
      reviewPeriodSeconds: m.reviewPeriodSeconds,
    })),
    rules: {
      autoRelease: d.rules.autoRelease,
      deadlineReclaim: d.rules.deadlineReclaim,
      reclaimGracePeriodSeconds: d.rules.reclaimGracePeriodSeconds,
      arbiter: d.rules.arbiter ? getAddress(d.rules.arbiter) : null,
      cancellationTerms: d.rules.cancellationTerms,
      disputeTerms: d.rules.disputeTerms,
    },
    references: d.references,
  };
}

/** Re-creates the editable draft from a stored terms document (for the edit form). */
export function termsToDraft(t: TermsDocument, hiringMode: "direct" | "open", skills: string[]): DraftInput {
  return {
    title: t.title,
    summary: t.summary,
    description: t.description,
    category: (CATEGORIES as readonly string[]).includes(t.category) ? (t.category as DraftInput["category"]) : "Other",
    skills,
    budget: toDecimalString(BigInt(t.totalAmount)),
    startDate: t.startDate,
    hiringMode,
    freelancer: t.freelancer === zeroAddress ? null : t.freelancer,
    milestones: t.milestones.map((m) => ({
      title: m.title,
      description: m.description,
      deliverables: m.deliverables,
      acceptanceCriteria: m.acceptanceCriteria,
      amount: toDecimalString(BigInt(m.amount)),
      deadline: m.deadline,
      reviewPeriodSeconds: m.reviewPeriodSeconds,
    })),
    rules: { ...t.rules },
    references: t.references,
  };
}

export const profileInputSchema = z.object({
  displayName: z.string().trim().min(2, "Display name needs at least 2 characters").max(60),
  role: z.enum(["client", "freelancer", "both"]),
  headline: z.string().trim().max(120).default(""),
  bio: z.string().trim().max(1500).default(""),
  skills: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  portfolioLinks: z.array(z.object({ label: z.string().trim().min(1).max(60), url: urlSchema })).max(10).default([]),
  socialLinks: z.array(z.object({ label: z.string().trim().min(1).max(40), url: urlSchema })).max(6).default([]),
  available: z.boolean().default(true),
  notificationPrefs: z
    .object({
      deadlines: z.boolean().default(true),
      reviews: z.boolean().default(true),
      payments: z.boolean().default(true),
      disputes: z.boolean().default(true),
      marketplace: z.boolean().default(true),
    })
    .partial()
    .default({}),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const applicationInputSchema = z.object({
  introduction: z.string().trim().min(20, "Write at least a short introduction (20+ characters)").max(3000),
  skills: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  portfolioLinks: z.array(urlSchema).max(8).default([]),
  proposedTimeline: z.string().trim().max(500).default(""),
  proposal: z.string().trim().max(4000).default(""),
});

export const noteInputSchema = z.object({
  kind: z.enum(["comment", "change_request", "dispute", "evidence"]),
  milestoneIndex: z.number().int().min(0).max(19).nullable(),
  body: z.string().trim().min(3, "Write a short note").max(4000),
  links: z.array(urlSchema).max(8).default([]),
});

export const txHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid transaction hash");

export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
export const ATTACHMENT_MIME = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
export const AVATAR_MAX_BYTES = 512 * 1024;

/** Sniffs magic bytes so a renamed file cannot smuggle another type past the allow-list. */
export function sniffMime(bytes: Uint8Array): (typeof ATTACHMENT_MIME)[number] | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  return null;
}
