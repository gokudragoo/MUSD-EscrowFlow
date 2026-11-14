import { describe, expect, it } from "vitest";
import { buildTermsDocument, draftInputSchema, sniffMime, termsToDraft, type DraftInput } from "@/lib/validation";
import { gasFloor, isRetryableTxError, withGasBuffer } from "@/lib/gas";
import { buildIcs, escapeIcsText, foldLine } from "@/lib/ics";
import { hashTerms, validateTermsDocument } from "@/lib/terms";
import { parseMusd } from "@/lib/money";

const CLIENT = "0x85bFEB7feA972E1269f14526e0195A7a841a3EfE";
const FREELANCER = "0x430999F89D1D1425E48af2904DCa0CFe2Cd7034f";
const future = (days: number) => Math.floor(Date.now() / 1000) + days * 86_400;

function draft(over: Partial<DraftInput> = {}): unknown {
  return {
    title: "Marketing website",
    summary: "",
    description: "Build a fast marketing website with a CMS.",
    category: "Development",
    skills: ["Next.js"],
    budget: "200",
    startDate: null,
    hiringMode: "direct",
    freelancer: FREELANCER.toLowerCase(),
    milestones: [
      ["UI design", "40"],
      ["Frontend", "60"],
      ["Backend", "60"],
      ["Final delivery", "40"],
    ].map(([title, amount], i) => ({
      title,
      description: "",
      deliverables: [],
      acceptanceCriteria: ["Reviewed by client"],
      amount,
      deadline: future(7 * (i + 1)),
      reviewPeriodSeconds: 3 * 86_400,
    })),
    rules: { autoRelease: true, deadlineReclaim: false, reclaimGracePeriodSeconds: 0, arbiter: null, cancellationTerms: "", disputeTerms: "" },
    references: [],
    ...over,
  };
}

describe("project draft validation (create project form + API)", () => {
  it("accepts the spec example and checksums addresses", () => {
    const d = draftInputSchema.parse(draft());
    expect(d.freelancer).toBe(FREELANCER);
  });
  it("rejects milestones that do not add up to the budget, with an exact message", () => {
    const r = draftInputSchema.safeParse(draft({ budget: "210" }));
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toContain("10 MUSD of the budget is unallocated");
    const over = draftInputSchema.safeParse(draft({ budget: "150" }));
    expect(over.error!.issues[0].message).toContain("50 MUSD over the budget");
  });
  it("requires a freelancer for direct hire but not for an open listing", () => {
    expect(draftInputSchema.safeParse(draft({ freelancer: null })).success).toBe(false);
    expect(draftInputSchema.safeParse(draft({ freelancer: null, hiringMode: "open" })).success).toBe(true);
  });
  it("rejects past deadlines, bad review periods, bad amounts and >20 milestones", () => {
    const base = draft() as { milestones: Record<string, unknown>[] };
    const past = structuredClone(base);
    past.milestones[0].deadline = Math.floor(Date.now() / 1000) - 10;
    expect(draftInputSchema.safeParse(past).success).toBe(false);
    const rp = structuredClone(base);
    rp.milestones[0].reviewPeriodSeconds = 30;
    expect(draftInputSchema.safeParse(rp).success).toBe(false);
    const amt = structuredClone(base);
    amt.milestones[0].amount = "-4";
    expect(draftInputSchema.safeParse(amt).success).toBe(false);
    const many = structuredClone(base);
    many.milestones = Array.from({ length: 21 }, () => base.milestones[0]);
    expect(draftInputSchema.safeParse(many).success).toBe(false);
  });
  it("rejects an arbiter that is also the freelancer, and invalid addresses", () => {
    const d = draft() as { rules: Record<string, unknown> };
    expect(draftInputSchema.safeParse({ ...d, rules: { ...d.rules, arbiter: FREELANCER } }).success).toBe(false);
    expect(draftInputSchema.safeParse(draft({ freelancer: "0x123" as never })).success).toBe(false);
  });
  it("buildTermsDocument produces a valid, stable, round-trippable document", () => {
    const d = draftInputSchema.parse(draft());
    const t = buildTermsDocument(d, CLIENT as `0x${string}`);
    expect(validateTermsDocument(t)).toEqual([]);
    expect(t.totalAmount).toBe(parseMusd("200").toString());
    expect(hashTerms(t)).toBe(hashTerms(buildTermsDocument(d, CLIENT as `0x${string}`)));
    const back = draftInputSchema.parse(termsToDraft(t, "direct", d.skills));
    expect(hashTerms(buildTermsDocument(back, CLIENT as `0x${string}`))).toBe(hashTerms(t));
  });
});

describe("upload sniffing", () => {
  it("recognises allowed types by magic bytes and rejects others", () => {
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffMime(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffMime(new TextEncoder().encode("MZ\x90\x00"))).toBeNull();
  });
});

describe("gas policy (EIP-7623 floor safety)", () => {
  it("uses max(estimate × 1.3, floor)", () => {
    expect(withGasBuffer(1_000_000n, 450_000n)).toBe(1_300_000n);
    expect(withGasBuffer(100_000n, 450_000n)).toBe(450_000n);
  });
  it("treats missing or bogus (<30k) estimates as invalid", () => {
    expect(withGasBuffer(21_644n, 260_000n)).toBe(260_000n);
    expect(withGasBuffer(null, 260_000n)).toBe(260_000n);
  });
  it("scales floors with milestone count and caps at 20", () => {
    expect(gasFloor("createProject", 4)).toBe(520_000n + 4n * 90_000n);
    expect(gasFloor("createProject", 50)).toBe(gasFloor("createProject", 20));
    expect(gasFloor("approveAndRelease")).toBeGreaterThan(105_194n * 2n);
  });
  it("classifies retryable nonce / transport errors", () => {
    expect(isRetryableTxError("nonce too low")).toBe(true);
    expect(isRetryableTxError("replacement transaction underpriced")).toBe(true);
    expect(isRetryableTxError("execution reverted: NotClient()")).toBe(false);
  });
});

describe("calendar export", () => {
  it("escapes text and folds long lines", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const folded = foldLine("SUMMARY:" + "x".repeat(200));
    expect(folded.split("\r\n ").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
  it("produces a valid VCALENDAR with one VEVENT per milestone", () => {
    const ics = buildIcs("Test", [
      { uid: "a@x", start: new Date("2026-11-01T10:00:00Z"), title: "Due: M1", description: "40 MUSD" },
      { uid: "b@x", start: new Date("2026-11-08T10:00:00Z"), title: "Due: M2" },
    ], new Date("2026-10-26T00:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("DTSTART:20261101T100000Z");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});
