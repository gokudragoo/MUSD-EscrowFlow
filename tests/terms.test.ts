import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes, zeroAddress } from "viem";
import { canonicalHash, canonicalize } from "@/lib/canonical";
import {
  compareTermsWithChain,
  hashNote,
  hashSubmission,
  hashTerms,
  termsToParams,
  validateTermsDocument,
  NOTE_SCHEMA,
  SUBMISSION_SCHEMA,
  TERMS_SCHEMA,
  type TermsDocument,
} from "@/lib/terms";
import { parseMusd } from "@/lib/money";

const CLIENT = "0x85bFEB7feA972E1269f14526e0195A7a841a3EfE";
const FREELANCER = "0x430999F89D1D1425E48af2904DCa0CFe2Cd7034f";
const ARBITER = "0xA8A724830bF7EA24Bbbe72B12ad95be6D016e25A";

export function sampleTerms(overrides: Partial<TermsDocument> = {}): TermsDocument {
  const now = 1_900_000_000;
  return {
    schema: TERMS_SCHEMA,
    title: "Marketing website",
    summary: "Four-milestone website build",
    description: "Design and build a marketing site.",
    category: "Development",
    client: CLIENT,
    freelancer: FREELANCER,
    chainId: 31611,
    token: { address: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503", symbol: "MUSD", decimals: 18 },
    totalAmount: parseMusd("200").toString(),
    startDate: "2026-11-01",
    milestones: [
      ["UI design", "40"],
      ["Frontend implementation", "60"],
      ["Backend integration", "60"],
      ["Final delivery", "40"],
    ].map(([title, amt], i) => ({
      title,
      description: "",
      deliverables: ["Figma file"],
      acceptanceCriteria: ["Matches the brief"],
      amount: parseMusd(amt).toString(),
      deadline: now + (i + 1) * 7 * 86_400,
      reviewPeriodSeconds: 3 * 86_400,
    })),
    rules: {
      autoRelease: true,
      deadlineReclaim: true,
      reclaimGracePeriodSeconds: 2 * 86_400,
      arbiter: null,
      cancellationTerms: "Mutual cancellation refunds unpaid milestones.",
      disputeTerms: "Parties negotiate a split.",
    },
    references: [],
    ...overrides,
  };
}

describe("canonical JSON", () => {
  it("sorts keys recursively and drops undefined", () => {
    expect(canonicalize({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: "s" }, z: undefined })).toBe('{"a":{"c":"s","d":[3,{"x":2,"y":1}]},"b":1}');
  });
  it("is independent of key insertion order", () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });
  it("keeps array order significant", () => {
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });
  it("rejects bigint, NaN and functions", () => {
    expect(() => canonicalize({ a: 1n })).toThrow();
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
    expect(() => canonicalize({ a: () => 1 })).toThrow();
  });
  it("hash = keccak256(utf8(canonical))", () => {
    expect(canonicalHash({ x: "é" })).toBe(keccak256(stringToBytes('{"x":"é"}')));
  });
});

describe("terms hashing and contract params", () => {
  it("any material change changes the hash", () => {
    const base = sampleTerms();
    const h = hashTerms(base);
    expect(hashTerms(sampleTerms())).toBe(h);
    const changed = sampleTerms();
    changed.milestones[1].amount = parseMusd("61").toString();
    expect(hashTerms(changed)).not.toBe(h);
    expect(hashTerms(sampleTerms({ freelancer: ARBITER }))).not.toBe(h);
  });
  it("termsToParams mirrors the document exactly", () => {
    const t = sampleTerms({ rules: { ...sampleTerms().rules, arbiter: ARBITER } });
    const p = termsToParams(t);
    expect(p.termsHash).toBe(hashTerms(t));
    expect(p.amounts).toEqual(["40", "60", "60", "40"].map(parseMusd));
    expect(p.deadlines.map(Number)).toEqual(t.milestones.map((m) => m.deadline));
    expect(p.reviewPeriods).toEqual([259200, 259200, 259200, 259200]);
    expect(p.arbiter).toBe(ARBITER);
    expect(termsToParams(sampleTerms()).arbiter).toBe(zeroAddress);
  });
  it("validateTermsDocument catches inconsistent documents", () => {
    expect(validateTermsDocument(sampleTerms())).toEqual([]);
    expect(validateTermsDocument(sampleTerms({ totalAmount: parseMusd("199").toString() }))).toContain("Milestone amounts do not add up to the budget");
    expect(validateTermsDocument(sampleTerms({ freelancer: CLIENT }))).toContain("Client and freelancer must be different wallets");
    const withClientArbiter = sampleTerms();
    withClientArbiter.rules = { ...withClientArbiter.rules, arbiter: CLIENT };
    expect(validateTermsDocument(withClientArbiter)).toContain("Arbiter must be a third party");
    const zero = sampleTerms();
    zero.milestones[0].amount = "0";
    expect(validateTermsDocument(zero)).toContain("Every milestone needs an amount above zero");
  });
});

describe("compareTermsWithChain", () => {
  const t = sampleTerms();
  const p = termsToParams(t);
  const chainProject = {
    client: CLIENT as `0x${string}`,
    freelancer: FREELANCER as `0x${string}`,
    arbiter: zeroAddress,
    termsHash: p.termsHash,
    autoRelease: true,
    deadlineReclaim: true,
    reclaimGracePeriod: 2 * 86_400,
    totalAmount: parseMusd("200"),
    milestoneCount: 4,
  };
  const chainMilestones = p.amounts.map((amount, i) => ({ amount, deadline: p.deadlines[i], reviewPeriod: p.reviewPeriods[i] }));
  it("passes when document and chain agree", () => {
    expect(compareTermsWithChain(t, chainProject, chainMilestones)).toEqual({ ok: true, mismatches: [] });
  });
  it("flags every divergent parameter", () => {
    const bad = compareTermsWithChain(t, { ...chainProject, autoRelease: false, totalAmount: 1n }, [
      { ...chainMilestones[0], amount: 1n },
      ...chainMilestones.slice(1),
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.mismatches).toEqual(
      expect.arrayContaining(["Auto-release rule differs", "Total amount differs", "Milestone 1 amount differs"]),
    );
  });
  it("flags a hash mismatch even if parameters match", () => {
    const r = compareTermsWithChain({ ...t, title: "Different" }, chainProject, chainMilestones);
    expect(r.mismatches).toContain("Terms hash differs from the on-chain hash");
  });
});

describe("sMUSD savings terms (v2)", () => {
  const withSavings = (bps: number) => sampleTerms({ rules: { ...sampleTerms().rules, savings: { enabled: true, freelancerShareBps: bps } } });

  it("leaves documents without savings byte-identical (old hashes still verify)", () => {
    const plain = sampleTerms();
    expect(Object.keys(plain.rules)).not.toContain("savings");
    expect(termsToParams(plain)).toMatchObject({ yieldEnabled: false, freelancerYieldBps: 0 });
  });

  it("passes the savings flag and split to the contract and changes the hash", () => {
    const t = withSavings(5000);
    expect(termsToParams(t)).toMatchObject({ yieldEnabled: true, freelancerYieldBps: 5000 });
    expect(hashTerms(t)).not.toBe(hashTerms(sampleTerms()));
  });

  it("checks the on-chain savings terms against the document", () => {
    const t = withSavings(2500);
    const p = termsToParams(t);
    const chainProject = {
      client: CLIENT as `0x${string}`,
      freelancer: FREELANCER as `0x${string}`,
      arbiter: zeroAddress,
      termsHash: p.termsHash,
      autoRelease: true,
      deadlineReclaim: true,
      reclaimGracePeriod: 2 * 86_400,
      totalAmount: parseMusd("200"),
      milestoneCount: 4,
    };
    const ms = p.amounts.map((amount, i) => ({ amount, deadline: p.deadlines[i], reviewPeriod: p.reviewPeriods[i] }));
    expect(compareTermsWithChain(t, chainProject, ms, { enabled: true, freelancerBps: 2500 }).ok).toBe(true);
    expect(compareTermsWithChain(t, chainProject, ms, { enabled: true, freelancerBps: 5000 }).mismatches).toContain("Savings yield split differs");
    expect(compareTermsWithChain(t, chainProject, ms, { enabled: false, freelancerBps: 0 }).mismatches).toContain("Savings (sMUSD) rule differs");
    // A v1 escrow (no getYield) can never satisfy a document that promises savings.
    expect(compareTermsWithChain(t, chainProject, ms).ok).toBe(false);
  });

  it("rejects an out-of-range split", () => {
    expect(validateTermsDocument(withSavings(10_001))).toContain("Savings yield split must be between 0 and 100%");
  });
});

describe("submission and note hashes", () => {
  it("commit to attachments and content", () => {
    const rec = {
      schema: SUBMISSION_SCHEMA,
      chainProjectId: "1",
      milestoneIndex: 0,
      freelancer: FREELANCER as `0x${string}`,
      description: "Delivered",
      links: ["https://github.com/x/y"],
      attachments: [{ name: "a.pdf", mime: "application/pdf", size: 10, sha256: "ab" }],
      createdAt: "2026-10-26T00:00:00.000Z",
    };
    const h = hashSubmission(rec);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashSubmission({ ...rec, attachments: [{ ...rec.attachments[0], sha256: "cd" }] })).not.toBe(h);
    const note = { schema: NOTE_SCHEMA, kind: "dispute" as const, chainProjectId: "1", milestoneIndex: 1, author: CLIENT as `0x${string}`, body: "x", createdAt: "t" };
    expect(hashNote(note)).not.toBe(hashNote({ ...note, kind: "change_request" }));
  });
});
