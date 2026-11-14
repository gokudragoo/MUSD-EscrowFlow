/**
 * Live end-to-end test against the running app + Mezo testnet (real MUSD, real transactions).
 *   BASE_URL=http://localhost:3000 npm run e2e        (or the production URL)
 *   E2E_SKIP_TIMED=1 skips the auto-release / deadline-reclaim project (needs ~4 minutes).
 *
 * Wallets: escrowflow.client / freelancer / stranger from the scratchpad test-wallets file (read at
 * runtime, never printed). Spec §26 scenario: 200 MUSD (40/60/60/40) → accept → fund → submit M1 →
 * approve + release 40 → dashboard 40 released / 160 held → history → stranger release reverts.
 * Plus: dispute + mutual split on M2, mutual cancellation refunding M3+M4, and a second project that
 * exercises auto-release after review timeout and deadline reclaim.
 * EscrowFlow v2: project A keeps its held budget in Mezo's sMUSD vault (MUSDSavingsRate, 50/50 yield
 * split) and the run proves the audit fixes live (dispute withdrawal clears a pending cancellation,
 * exact-refund cancellation, no freelancer dispute on undelivered work, minimum reclaim grace).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  parseSignature,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { createSiweMessage } from "viem/siwe";
import { loadTestWallets, publicClient, revertName, sendRaw, writeContract, type TestWallet } from "./lib/tx";
import { ESCROW_ADDRESS, MUSD_ADDRESS, SMUSD_ADDRESS, escrowFlowAbi, musdAbi } from "../src/config/contracts";
import { MUSD_PERMIT_DOMAIN_NAME, MUSD_PERMIT_DOMAIN_VERSION } from "../src/config/abi/musd";
import { explorerTx } from "../src/config/chains";
import { gasFloor, ERC20_GAS_FLOOR } from "../src/lib/gas";
import { compareTermsWithChain, termsToParams, type TermsDocument } from "../src/lib/terms";
import { formatMusd, parseMusd, toDecimalString } from "../src/lib/money";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SKIP_TIMED = process.env.E2E_SKIP_TIMED === "1";
/** Continue an interrupted run from an existing project A (funded, M1 released) instead of creating a new one. */
const RESUME = process.env.E2E_RESUME_PROJECT ?? "";
/** Scale project A down for local rehearsals (e.g. E2E_DIVISOR=10 → 20 MUSD); production runs use 1 (200 MUSD). */
const DIVISOR = BigInt(process.env.E2E_DIVISOR ?? "1");
const amt = (x: string) => parseMusd(x) / DIVISOR;
const dec = (x: string) => toDecimalString(amt(x));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ reporting
const results: { step: string; ok: boolean; detail?: string }[] = [];
const txs: { label: string; hash: string; status: string }[] = [];
function check(ok: boolean, step: string, detail?: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`Assertion failed: ${step}${detail ? ` (${detail})` : ""}`);
}
function recordTx(label: string, hash: string, receipt: TransactionReceipt) {
  txs.push({ label, hash, status: receipt.status });
  console.log(`        tx ${label}: ${hash} (${receipt.status}, gas ${receipt.gasUsed})`);
}

// ------------------------------------------------------------------ HTTP + SIWE
class Client {
  cookie = "";
  constructor(public w: TestWallet) {}
  async req<T = unknown>(method: string, p: string, body?: unknown, raw?: BodyInit): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${BASE}${p}`, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: "manual" });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const m = setCookie.match(/ef_session=([^;]*)/);
      if (m) this.cookie = m[1] ? `ef_session=${m[1]}` : "";
    }
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // non-JSON
    }
    return { status: res.status, data: data as T };
  }
  async login() {
    const { data: n } = await this.req<{ nonce: string }>("GET", "/api/auth/nonce");
    const url = new URL(BASE);
    const message = createSiweMessage({
      address: this.w.address,
      chainId: 31611,
      domain: url.host,
      nonce: n.nonce,
      uri: url.origin,
      version: "1",
      statement: "Sign in to MUSD EscrowFlow (e2e).",
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 10 * 60_000),
    });
    const signature = await this.w.account.signMessage!({ message });
    const r = await this.req<{ address: string }>("POST", "/api/auth/verify", { message, signature });
    return { r, message, signature };
  }
}

// ------------------------------------------------------------------ chain helpers
async function tx(w: TestWallet, label: string, functionName: string, args: readonly unknown[], floor: bigint, address: Address = ESCROW_ADDRESS) {
  const abi = address === ESCROW_ADDRESS ? escrowFlowAbi : musdAbi;
  const { hash, receipt } = await writeContract({ account: w.account, address, abi: abi as never, functionName, args, gasFloor: floor, label });
  recordTx(label, hash, receipt);
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${explorerTx(hash)}`);
  return { hash, receipt };
}

async function expectRevert(w: TestWallet, label: string, functionName: string, args: readonly unknown[], expected: string) {
  try {
    await publicClient.simulateContract({ account: w.account, address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: functionName as never, args: args as never });
    check(false, label, "call unexpectedly succeeded");
  } catch (e) {
    const name = revertName(e) ?? "";
    check(name.includes(expected), label, `reverted with ${name}`);
  }
}

async function readProject(id: bigint) {
  return publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "getProject", args: [id] });
}
async function readYield(id: bigint) {
  return publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "getYield", args: [id] });
}

async function musdBalance(a: Address) {
  return publicClient.readContract({ address: MUSD_ADDRESS, abi: musdAbi, functionName: "balanceOf", args: [a] });
}

function musdTransfers(receipt: TransactionReceipt) {
  return receipt.logs
    .filter((l) => l.address.toLowerCase() === MUSD_ADDRESS.toLowerCase())
    .map((l) => {
      try {
        const ev = decodeEventLog({ abi: musdAbi, data: l.data, topics: l.topics });
        if (ev.eventName !== "Transfer") return null;
        const a = ev.args as { from: Address; to: Address; value: bigint };
        return { from: getAddress(a.from), to: getAddress(a.to), value: a.value };
      } catch {
        return null;
      }
    })
    .filter((x): x is { from: Address; to: Address; value: bigint } => !!x);
}

async function verifyTx(c: Client, hash: Hex, expectEvent: string) {
  for (let i = 0; i < 8; i++) {
    const r = await c.req<{ status: string; events?: { eventName: string }[]; problems?: string[] }>("POST", "/api/tx/verify", { txHash: hash });
    if (r.status === 200 && r.data.status === "confirmed") {
      check(!!r.data.events?.some((e) => e.eventName === expectEvent), `app verified ${expectEvent}`, `tx ${hash.slice(0, 12)}…`);
      return r.data;
    }
    if (r.status === 200 && r.data.status === "mismatch") check(false, `app verified ${expectEvent}`, JSON.stringify(r.data.problems));
    await sleep(2000);
  }
  check(false, `app verified ${expectEvent}`, "verification never confirmed");
}

const future = (s: number) => Math.floor(Date.now() / 1000) + s;
let yieldToFreelancer = 0n;
let yieldToClient = 0n;

/** Waits until the chain's latest block timestamp passes `ts` (block time can lag the local clock). */
async function waitForChainTime(ts: number, label: string) {
  for (let i = 0; i < 120; i++) {
    const b = await publicClient.getBlock();
    if (Number(b.timestamp) > ts) return;
    if (i === 0) console.log(`        waiting for chain time to pass ${label} (${ts - Number(b.timestamp)}s)…`);
    await sleep(4000);
  }
}

async function reclaimB(client: Client, w: Record<string, TestWallet>, chainId: bigint) {
  const availableAt = await publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "reclaimAvailableAt", args: [chainId, 1n] });
  await waitForChainTime(Number(availableAt), "deadline + grace");
  const reclaim = await tx(client.w, "B: reclaimExpiredMilestone M2", "reclaimExpiredMilestone", [chainId, 1n], gasFloor("reclaimExpiredMilestone"));
  check(musdTransfers(reclaim.receipt).some((t) => t.to === w.client.address && t.value === parseMusd("1")), "deadline reclaim: 1 MUSD returned to the client for the undelivered milestone");
  await verifyTx(client, reclaim.hash, "MilestoneRefunded");
  const pb = await readProject(chainId);
  check(pb.status === 4 && pb.releasedAmount + pb.refundedAmount === pb.fundedAmount, "project B closed as Completed and reconciled");
}

function draft(freelancer: Address, opts: { title: string; budget: string; milestones: { title: string; amount: string; deadline: number; review: number }[]; autoRelease: boolean; deadlineReclaim: boolean; grace: number; savingsBps?: number }) {
  return {
    title: opts.title,
    summary: "Live e2e test project on Mezo testnet",
    description: "Automated end-to-end test of the EscrowFlow funding-to-payment lifecycle with real MUSD.",
    category: "Development",
    skills: ["Next.js", "Solidity"],
    budget: opts.budget,
    startDate: null,
    hiringMode: "direct",
    freelancer,
    milestones: opts.milestones.map((m) => ({
      title: m.title,
      description: "",
      deliverables: ["Working build"],
      acceptanceCriteria: ["Client verifies the deliverable"],
      amount: m.amount,
      deadline: m.deadline,
      reviewPeriodSeconds: m.review,
    })),
    rules: {
      autoRelease: opts.autoRelease,
      deadlineReclaim: opts.deadlineReclaim,
      reclaimGracePeriodSeconds: opts.grace,
      arbiter: null,
      cancellationTerms: "Mutual cancellation refunds unpaid, undisputed milestones.",
      disputeTerms: "Parties agree a split on-chain.",
      ...(opts.savingsBps !== undefined ? { savings: { enabled: true, freelancerShareBps: opts.savingsBps } } : {}),
    },
    references: [],
  };
}

interface ProjectView {
  access: string;
  private: boolean;
  terms: TermsDocument | null;
  onchainTerms: TermsDocument | null;
  project: { chainProjectId: string | null };
  chain: { ledger: Record<string, string>; project: Record<string, unknown>; milestones: Record<string, unknown>[] } | null;
  timeline: { kind: string; source: string }[];
}

/** Creates a draft via the API, creates the escrow on-chain and links it (server-verified). */
async function createAndLink(client: Client, body: unknown, label: string) {
  const created = await client.req<{ id: string; termsHash: string }>("POST", "/api/projects", body);
  check(created.status === 201, `${label}: agreement draft saved via API`, `id ${created.data.id}`);
  const view = await client.req<ProjectView>("GET", `/api/projects/${created.data.id}`);
  const terms = view.data.terms!;
  const params = termsToParams(terms);
  check(params.termsHash === created.data.termsHash, `${label}: client recomputes the same terms hash`);
  const { hash } = await tx(client.w, `${label}: createProject`, "createProject", [params], gasFloor("createProject", terms.milestones.length));
  let link: { status: number; data: { status: string; chainProjectId: string } } = { status: 0, data: { status: "", chainProjectId: "" } };
  for (let i = 0; i < 6; i++) {
    link = await client.req("POST", `/api/projects/${created.data.id}/link`, { txHash: hash });
    if (link.status === 200 && link.data.status === "confirmed") break;
    await sleep(2000);
  }
  check(link.status === 200 && link.data.status === "confirmed", `${label}: server verified createProject and linked escrow`, `escrow #${link.data.chainProjectId}`);
  return { projectId: created.data.id, chainId: BigInt(link.data.chainProjectId), terms, createHash: hash };
}

async function freelancerAccepts(freelancer: Client, projectId: string, chainId: bigint, label: string) {
  const v = await freelancer.req<ProjectView>("GET", `/api/projects/${projectId}`);
  check(v.data.access === "freelancer" && !!v.data.onchainTerms, `${label}: freelancer sees the committed terms`);
  const p = await readProject(chainId);
  const ms = await publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "getMilestones", args: [chainId] });
  const y = await readYield(chainId);
  const cmp = compareTermsWithChain(v.data.onchainTerms!, p as never, ms as never, { enabled: y.enabled, freelancerBps: y.freelancerBps });
  check(cmp.ok, `${label}: terms document matches on-chain parameters (independent check)`, cmp.mismatches.join("; "));
  const { hash } = await tx(freelancer.w, `${label}: acceptTerms`, "acceptTerms", [chainId, p.termsHash, p.termsVersion], gasFloor("acceptTerms"));
  await verifyTx(freelancer, hash, "TermsAccepted");
}

async function submitMilestone(freelancer: Client, projectId: string, chainId: bigint, index: number, label: string) {
  const fd = new FormData();
  fd.set("milestoneIndex", String(index));
  fd.set("description", `Milestone ${index + 1} delivered: implementation complete and deployed to the preview URL.`);
  fd.set("links", JSON.stringify(["https://github.com/mezo-org/musd"]));
  // A tiny valid PNG (1×1) as an access-controlled attachment.
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
  fd.append("files", new Blob([png], { type: "image/png" }), "preview.png");
  const r = await freelancer.req<{ id: string; submissionHash: Hex }>("POST", `/api/projects/${projectId}/submissions`, undefined, fd);
  check(r.status === 201, `${label}: submission record + attachment stored`, `hash ${r.data.submissionHash?.slice(0, 12)}…`);
  const { hash } = await tx(freelancer.w, `${label}: submitMilestone`, "submitMilestone", [chainId, BigInt(index), r.data.submissionHash], gasFloor("submitMilestone"));
  await verifyTx(freelancer, hash, "MilestoneSubmitted");
  return { submissionHash: r.data.submissionHash, txHash: hash };
}

// ------------------------------------------------------------------ main
async function finishB(projectId: string) {
  const w = loadTestWallets("escrowflow");
  const client = new Client(w.client);
  const { r } = await client.login();
  check(r.status === 200, "SIWE sign-in as client");
  const v = await client.req<ProjectView>("GET", `/api/projects/${projectId}`);
  const chainId = BigInt(v.data.project.chainProjectId!);
  const c0 = await musdBalance(w.client.address);
  await reclaimB(client, w, chainId);
  check((await musdBalance(w.client.address)) - c0 === parseMusd("1"), "client balance increased by exactly the reclaimed 1 MUSD");
}

async function main() {
  console.log(`EscrowFlow e2e against ${BASE}\nEscrow contract ${ESCROW_ADDRESS}\n`);
  const w = loadTestWallets("escrowflow");
  const client = new Client(w.client);
  const freelancer = new Client(w.freelancer);
  const stranger = new Client(w.stranger);

  const health = await client.req<{ db: string; rpc: string; chainId: number }>("GET", "/api/health");
  check(health.status === 200 && health.data.db === "ok" && health.data.rpc === "ok" && health.data.chainId === 31611, "health: db + rpc ok on chain 31611");

  // --- SIWE login (+ replay rejection)
  for (const c of [client, freelancer, stranger]) {
    const { r } = await c.login();
    check(r.status === 200 && r.data.address === c.w.address, `SIWE sign-in as ${c.w.role}`);
  }
  {
    const tmp = new Client(w.stranger);
    const { message, signature } = await tmp.login();
    const replay = await tmp.req("POST", "/api/auth/verify", { message, signature });
    check(replay.status === 401, "negative: replayed SIWE message is rejected (single-use nonce)", `HTTP ${replay.status}`);
  }
  const unauth = await new Client(w.stranger).req("GET", "/api/dashboard");
  check(unauth.status === 401, "negative: dashboard without a session is 401");

  await client.req("PUT", "/api/me/profile", { displayName: "E2E Client Co.", role: "client", headline: "Small business hiring contractors", bio: "", skills: [], portfolioLinks: [], socialLinks: [], available: true, notificationPrefs: {} });
  const prof = await freelancer.req("PUT", "/api/me/profile", { displayName: "E2E Freelancer", role: "freelancer", headline: "Full-stack developer", bio: "Builds web apps.", skills: ["Next.js", "Solidity"], portfolioLinks: [{ label: "GitHub", url: "https://github.com/mezo-org" }], socialLinks: [], available: true, notificationPrefs: {} });
  check(prof.status === 200, "profiles saved for client and freelancer");

  const startClient = await musdBalance(w.client.address);
  const startFreelancer = await musdBalance(w.freelancer.address);
  console.log(`\n  client MUSD ${formatMusd(startClient)} · freelancer MUSD ${formatMusd(startFreelancer)}\n`);
  if (!RESUME) check(startClient >= amt("200") + (SKIP_TIMED ? 0n : parseMusd("2")), "client holds enough MUSD for the scenario");

  // ============ Project A: spec §26 scenario ============
  let A: { projectId: string; chainId: bigint };
  if (!RESUME) {
  const bad = await client.req("POST", "/api/projects", draft(w.freelancer.address, {
    title: "Invalid budget", budget: "210", autoRelease: true, deadlineReclaim: false, grace: 0,
    milestones: [40, 60, 60, 40].map((a, i) => ({ title: `M${i + 1}`, amount: String(a), deadline: future((i + 1) * 7 * 86400), review: 3 * 86400 })),
  }));
  check(bad.status === 400, "negative: milestones not adding up to the budget are rejected", String((bad.data as { error?: string }).error));

  A = await createAndLink(
    client,
    draft(w.freelancer.address, {
      title: "Website build — e2e (spec §26, sMUSD savings)",
      budget: dec("200"),
      autoRelease: true,
      deadlineReclaim: true,
      grace: 86400,
      savingsBps: 5000,
      milestones: [
        { title: "UI design", amount: dec("40"), deadline: future(7 * 86400), review: 3 * 86400 },
        { title: "Frontend implementation", amount: dec("60"), deadline: future(14 * 86400), review: 3 * 86400 },
        { title: "Backend integration", amount: dec("60"), deadline: future(21 * 86400), review: 3 * 86400 },
        { title: "Final delivery", amount: dec("40"), deadline: future(28 * 86400), review: 3 * 86400 },
      ],
    }),
    "A",
  );

  await expectRevert(w.stranger, "negative: stranger cannot accept the terms", "acceptTerms", [A.chainId, (await readProject(A.chainId)).termsHash, 1], "NotFreelancer");
  await expectRevert(w.client, "negative: client cannot fund before the freelancer accepts", "fund", [A.chainId], "InvalidProjectStatus");
  await freelancerAccepts(freelancer, A.projectId, A.chainId, "A");

  // Fund 200 MUSD with an EIP-2612 permit (single tx) on the real MUSD token.
  const total = amt("200");
  const nonce = await publicClient.readContract({ address: MUSD_ADDRESS, abi: musdAbi, functionName: "nonces", args: [w.client.address] });
  const deadline = BigInt(future(1800));
  const sig = await w.client.account.signTypedData!({
    domain: { name: MUSD_PERMIT_DOMAIN_NAME, version: MUSD_PERMIT_DOMAIN_VERSION, chainId: 31611, verifyingContract: MUSD_ADDRESS },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    message: { owner: w.client.address, spender: ESCROW_ADDRESS, value: total, nonce, deadline },
  });
  const { v, r, s, yParity } = parseSignature(sig);
  const fundA = await tx(client.w, "A: fundWithPermit 200 MUSD", "fundWithPermit", [A.chainId, deadline, v !== undefined ? Number(v) : yParity + 27, r, s], gasFloor("fundWithPermit", 4));
  const fundTransfers = musdTransfers(fundA.receipt);
  check(fundTransfers.some((t) => t.from === w.client.address && t.to === getAddress(ESCROW_ADDRESS) && t.value === total), "funding: MUSD Transfer client → escrow of exactly 200 MUSD");
  check(
    fundTransfers.some((t) => t.from === getAddress(ESCROW_ADDRESS) && t.to === getAddress(SMUSD_ADDRESS) && t.value === total),
    "sMUSD: the escrow deposited exactly the funded budget into Mezo's MUSDSavingsRate vault in the same tx",
  );
  {
    const y = await readYield(A.chainId);
    check(y.enabled && y.freelancerBps === 5000 && y.principal === total, "sMUSD: getYield reports savings on, 50/50 split, principal = held budget");
  }
  await verifyTx(client, fundA.hash, "ProjectFunded");
  {
    const v1 = await client.req<ProjectView>("GET", `/api/projects/${A.projectId}`);
    check(v1.data.chain?.ledger.funded === total.toString() && v1.data.chain?.ledger.held === total.toString(), "app shows the escrow fully funded (200 held) from contract state");
  }
  await expectRevert(w.client, "negative: funding twice is rejected", "fund", [A.chainId], "InvalidProjectStatus");

  // M1 submit → approve → release
  await submitMilestone(freelancer, A.projectId, A.chainId, 0, "A/M1");
  {
    const sv = await stranger.req<ProjectView>("GET", `/api/projects/${A.projectId}`);
    check(sv.data.private === true && sv.data.terms === undefined, "negative: stranger cannot read private project terms");
    const subs = await freelancer.req<{ submissions: { attachments: { url: string }[] }[] }>("GET", `/api/projects/${A.projectId}/submissions`);
    const url = subs.data.submissions[0]?.attachments[0]?.url;
    const sAtt = await stranger.req("GET", url);
    const cAtt = await client.req("GET", url);
    check(sAtt.status === 403 && cAtt.status === 200, "attachments are served only to participants", `stranger ${sAtt.status} · client ${cAtt.status}`);
  }

  await expectRevert(w.stranger, "negative: stranger cannot release M1 (simulation)", "approveAndRelease", [A.chainId, 0n], "NotClient");
  await expectRevert(w.freelancer, "negative: freelancer cannot release their own milestone", "approveAndRelease", [A.chainId, 0n], "NotClient");
  {
    // Record the stranger's unauthorised release attempt on-chain: it must revert and move nothing.
    const data = encodeFunctionData({ abi: escrowFlowAbi, functionName: "approveAndRelease", args: [A.chainId, 0n] });
    const before = await musdBalance(w.stranger.address);
    const { hash, receipt } = await sendRaw({ account: w.stranger.account, to: ESCROW_ADDRESS, data, gasFloor: 200_000n, label: "stranger approveAndRelease", skipEstimate: true });
    recordTx("stranger approveAndRelease (expected revert)", hash, receipt);
    const p = await readProject(A.chainId);
    check(receipt.status === "reverted" && p.releasedAmount === 0n && (await musdBalance(w.stranger.address)) === before, "unauthorised release reverted on-chain; nothing released");
  }

  const fBefore = await musdBalance(w.freelancer.address);
  const rel = await tx(client.w, "A: approveAndRelease M1", "approveAndRelease", [A.chainId, 0n], gasFloor("approveAndRelease"));
  const relT = musdTransfers(rel.receipt);
  check(
    relT.filter((t) => t.from === getAddress(ESCROW_ADDRESS)).length === 1 &&
      relT.some((t) => t.from === getAddress(ESCROW_ADDRESS) && t.to === w.freelancer.address && t.value === amt("40")),
    "release: exactly one MUSD Transfer out of the escrow, to the freelancer, of exactly 40 MUSD",
  );
  check(
    relT.some((t) => t.from === getAddress(SMUSD_ADDRESS) && t.to === getAddress(ESCROW_ADDRESS) && t.value >= amt("40")),
    "sMUSD: the release withdrew the milestone's principal 1:1 from the savings vault",
  );
  check((await readYield(A.chainId)).principal === amt("160"), "sMUSD: vault principal now equals the 160 still held");
  await verifyTx(client, rel.hash, "MilestoneReleased");
  check((await musdBalance(w.freelancer.address)) - fBefore === amt("40"), "freelancer balance increased by exactly 40 MUSD");
  await expectRevert(w.client, "negative: duplicate release of M1 is rejected", "approveAndRelease", [A.chainId, 0n], "InvalidMilestoneStatus");
  await expectRevert(w.freelancer, "negative: freelancer cannot claim an already-paid milestone", "claimAfterReviewTimeout", [A.chainId, 0n], "InvalidMilestoneStatus");
  } else {
    const rv = await client.req<ProjectView>("GET", `/api/projects/${RESUME}`);
    A = { projectId: RESUME, chainId: BigInt(rv.data.project.chainProjectId!) };
    const p = await readProject(A.chainId);
    check(p.status === 3 && p.fundedAmount === amt("200") && p.releasedAmount === amt("40"), `resume: escrow #${A.chainId} is funded with 200 MUSD and M1 (40 MUSD) already released on-chain`);
    await expectRevert(w.client, "negative: duplicate release of M1 is rejected", "approveAndRelease", [A.chainId, 0n], "InvalidMilestoneStatus");
  }

  {
    type Dash = { client: { lockedWei: string }; freelancer: { allocatedWei: string }; projects: { chainProjectId: string; ledger: Record<string, string> }[] };
    const dc = await client.req<Dash>("GET", "/api/dashboard");
    const pc = dc.data.projects.find((p) => p.chainProjectId === A.chainId.toString());
    check(
      pc?.ledger.released === amt("40").toString() && pc?.ledger.held === amt("160").toString() && dc.data.client.lockedWei === amt("160").toString(),
      "client dashboard: project shows 40 MUSD released and 160 MUSD held (wallet total locked: 160)",
    );
    const df = await freelancer.req<Dash>("GET", "/api/dashboard");
    const pf = df.data.projects.find((p) => p.chainProjectId === A.chainId.toString());
    check(pf?.ledger.released === amt("40").toString() && df.data.freelancer.allocatedWei === amt("160").toString(), "freelancer dashboard: 40 released to them, 160 allocated (not earned)");
    const pv = await client.req<ProjectView>("GET", `/api/projects/${A.projectId}`);
    const kinds = pv.data.timeline.map((t) => `${t.source}:${t.kind}`);
    check(
      ["chain:MilestoneSubmitted", "chain:MilestoneReleased", "chain:ProjectFunded", "chain:TermsAccepted", "app:submission_recorded"].every((k) => kinds.includes(k)),
      "project history records submission, approval/payment and funding (chain facts + app records)",
    );
    const nf = await freelancer.req<{ notifications: { title: string }[] }>("GET", "/api/notifications");
    check(nf.data.notifications.some((n) => n.title.startsWith("Payment received")), "freelancer notified of the verified payment");
  }

  // M2: submit → client disputes → evidence → split 30/30
  await submitMilestone(freelancer, A.projectId, A.chainId, 1, "A/M2");
  const reason = await client.req<{ noteHash: Hex }>("POST", `/api/projects/${A.projectId}/notes`, { kind: "dispute", milestoneIndex: 1, body: "The frontend misses two pages from the brief.", links: [] });
  check(reason.status === 201 && !!reason.data.noteHash, "dispute reason stored; hash ready for chain");
  const disp = await tx(client.w, "A: openDispute M2", "openDispute", [A.chainId, 1n, reason.data.noteHash], gasFloor("openDispute"));
  await verifyTx(client, disp.hash, "DisputeOpened");
  await expectRevert(w.freelancer, "negative: freelancer cannot dispute M3, which was never delivered (v2)", "openDispute", [A.chainId, 2n, reason.data.noteHash], "NothingSubmitted");

  // Audit MUST-FIX, live: freelancer proposes cancellation while M2 is disputed; the client then
  // withdraws the dispute. In v1 the client could now accept the cancellation and sweep M2.
  await tx(freelancer.w, "A: proposeCancellation (freelancer, M2 disputed)", "proposeCancellation", [A.chainId], gasFloor("proposeCancellation"));
  const wd = await tx(client.w, "A: withdrawDispute M2", "withdrawDispute", [A.chainId, 1n], gasFloor("withdrawDispute"));
  await verifyTx(client, wd.hash, "DisputeWithdrawn");
  check((await readProject(A.chainId)).cancelProposer === "0x0000000000000000000000000000000000000000", "audit fix: withdrawing the dispute cleared the pending cancellation on-chain");
  await expectRevert(w.client, "audit fix: client can no longer sweep the submitted M2 via the old cancellation", "acceptCancellation", [A.chainId, amt("160")], "NoCancellationProposal");
  const disp2 = await tx(client.w, "A: openDispute M2 again", "openDispute", [A.chainId, 1n, reason.data.noteHash], gasFloor("openDispute"));
  await verifyTx(client, disp2.hash, "DisputeOpened");
  await expectRevert(w.client, "negative: disputed M2 cannot be released while frozen", "approveAndRelease", [A.chainId, 1n], "InvalidMilestoneStatus");
  await expectRevert(w.freelancer, "negative: disputed M2 cannot be claimed", "claimAfterReviewTimeout", [A.chainId, 1n], "InvalidMilestoneStatus");
  const ev = await freelancer.req("POST", `/api/projects/${A.projectId}/notes`, { kind: "evidence", milestoneIndex: 1, body: "Both pages are in the preview build; see commit abc123.", links: ["https://github.com/mezo-org/musd"] });
  check(ev.status === 201, "freelancer added dispute evidence (application record)");
  await tx(client.w, "A: proposeSettlement 30/30", "proposeSettlement", [A.chainId, 1n, amt("30")], gasFloor("proposeSettlement"));
  await expectRevert(w.client, "negative: client cannot accept its own proposal", "acceptSettlement", [A.chainId, 1n, amt("30")], "CannotAcceptOwnProposal");
  const settle = await tx(freelancer.w, "A: acceptSettlement", "acceptSettlement", [A.chainId, 1n, amt("30")], gasFloor("acceptSettlement"));
  const st = musdTransfers(settle.receipt);
  check(
    st.some((t) => t.to === w.freelancer.address && t.value === amt("30")) && st.some((t) => t.to === w.client.address && t.value === amt("30")),
    "settlement: 30 MUSD to freelancer and 30 MUSD back to client in one tx",
  );
  await verifyTx(freelancer, settle.hash, "DisputeResolved");
  {
    const d = await client.req<{ closed: { outcome: string }[] }>("GET", "/api/disputes");
    check(d.data.closed.some((c) => c.outcome === "Mutual settlement"), "dispute centre lists the resolved settlement");
  }

  // Cancellation of the rest (M3 + M4 = 100 MUSD back to client)
  await tx(client.w, "A: proposeCancellation", "proposeCancellation", [A.chainId], gasFloor("proposeCancellation"));
  await expectRevert(w.stranger, "negative: stranger cannot accept the cancellation", "acceptCancellation", [A.chainId, amt("100")], "NotParty");
  await expectRevert(w.freelancer, "negative: accepting with a different refund than the contract would pay reverts (v2)", "acceptCancellation", [A.chainId, amt("160")], "RefundMismatch");
  const cBefore = await musdBalance(w.client.address);
  const cancel = await tx(freelancer.w, "A: acceptCancellation (exact refund 100)", "acceptCancellation", [A.chainId, amt("100")], gasFloor("acceptCancellation", 4));
  check((await musdBalance(w.client.address)) - cBefore === amt("100"), "cancellation refunded exactly 100 MUSD (M3 + M4) to the client");
  await verifyTx(freelancer, cancel.hash, "ProjectCancelled");
  {
    const p = await readProject(A.chainId);
    check(
      p.status === 5 && p.fundedAmount === amt("200") && p.releasedAmount === amt("70") && p.refundedAmount === amt("130"),
      "final ledger A: funded 200 = released 70 + refunded 130 + held 0 (status Cancelled)",
    );
    const pay = await client.req<{ items: { event: string }[] }>("GET", "/api/payments");
    const evs = pay.data.items.map((i) => i.event);
    check(["ProjectFunded", "MilestoneReleased", "DisputeResolved", "ProjectCancelled"].every((e) => evs.includes(e)), "payments page lists funding, release, settlement and refund");
    const y = await readYield(A.chainId);
    check(y.principal === 0n, "sMUSD: nothing of project A is left in the vault once it is settled");
    if (y.accrued > 0n) {
      const f0 = await musdBalance(w.freelancer.address);
      const dist = await tx(client.w, "A: distributeYield", "distributeYield", [A.chainId], gasFloor("distributeYield"));
      await verifyTx(client, dist.hash, "YieldDistributed");
      yieldToFreelancer = (await musdBalance(w.freelancer.address)) - f0;
      yieldToClient = (await readYield(A.chainId)).paid - yieldToFreelancer;
      check(yieldToFreelancer >= 0n && (await readYield(A.chainId)).accrued === 0n, `sMUSD: yield paid out 50/50 (${formatMusd(yieldToFreelancer, { maxDecimals: 8 })} MUSD to the freelancer)`);
    } else {
      await expectRevert(w.client, "sMUSD: no testnet yield accrued in this window, so distribution correctly reverts", "distributeYield", [A.chainId], "NothingToDistribute");
    }
  }

  // ============ Project B: auto-release after review timeout + deadline reclaim ============
  if (!SKIP_TIMED) {
    const B = await createAndLink(
      client,
      draft(w.freelancer.address, {
        title: "Unresponsive-client scenario — e2e",
        budget: "2",
        autoRelease: true,
        deadlineReclaim: true,
        grace: 60,
        milestones: [
          { title: "Quick fix", amount: "1", deadline: future(3600), review: 60 },
          { title: "Never delivered", amount: "1", deadline: future(170), review: 60 },
        ],
      }),
      "B",
    );
    await freelancerAccepts(freelancer, B.projectId, B.chainId, "B");
    await tx(client.w, "B: approve 2 MUSD", "approve", [ESCROW_ADDRESS, parseMusd("2")], ERC20_GAS_FLOOR, MUSD_ADDRESS);
    const fundB = await tx(client.w, "B: fund", "fund", [B.chainId], gasFloor("fund", 2));
    await verifyTx(client, fundB.hash, "ProjectFunded");
    await submitMilestone(freelancer, B.projectId, B.chainId, 0, "B/M1");
    await expectRevert(w.freelancer, "negative: claim before the review period ends is rejected", "claimAfterReviewTimeout", [B.chainId, 0n], "ReviewWindowOpen");
    console.log("        waiting 70s for the 60s review period to elapse…");
    await sleep(70_000);
    await waitForChainTime(Number(await publicClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "reviewDeadline", args: [B.chainId, 0n] })), "review deadline");
    await expectRevert(w.client, "negative: client cannot request changes after the agreed review period", "requestChanges", [B.chainId, 0n, "0x" + "11".repeat(32)], "ReviewWindowElapsed");
    const claim = await tx(freelancer.w, "B: claimAfterReviewTimeout M1", "claimAfterReviewTimeout", [B.chainId, 0n], gasFloor("claimAfterReviewTimeout"));
    check(musdTransfers(claim.receipt).some((t) => t.to === w.freelancer.address && t.value === parseMusd("1")), "auto-release: freelancer claimed 1 MUSD after the unanswered review period");
    await verifyTx(freelancer, claim.hash, "MilestoneReleased");
    await reclaimB(client, w, B.chainId);
  }

  const endClient = await musdBalance(w.client.address);
  const endFreelancer = await musdBalance(w.freelancer.address);
  console.log(`\n  client MUSD ${formatMusd(startClient)} → ${formatMusd(endClient)} · freelancer MUSD ${formatMusd(startFreelancer)} → ${formatMusd(endFreelancer)}`);
  const b = SKIP_TIMED ? 0n : parseMusd("1");
  // (yieldToFreelancer / yieldToClient are the sMUSD savings shares, 0 if no testnet yield accrued.)
  // Full run: client funds 200 (+2), gets 30 + 100 (+1) back. Resumed run starts after funding + M1.
  const expFreelancer = (RESUME ? amt("30") : amt("70")) + b + yieldToFreelancer;
  const expClientSpend = (RESUME ? -amt("130") : amt("70")) + b - yieldToClient;
  check(endFreelancer - startFreelancer === expFreelancer, "freelancer net gain matches released amounts exactly");
  check(startClient - endClient === expClientSpend, "client net balance change matches releases and refunds exactly");
  return { A, endClient, endFreelancer };
}

(process.env.E2E_FINISH_B ? finishB(process.env.E2E_FINISH_B).then(() => ({ A: { projectId: process.env.E2E_FINISH_B!, chainId: 0n } })) : main())
  .then(({ A }) => {
    const out = {
      baseUrl: BASE,
      ranAt: new Date().toISOString(),
      escrow: ESCROW_ADDRESS,
      projectA: { id: A.projectId, chainId: A.chainId.toString() },
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
      transactions: txs.map((t) => ({ ...t, explorer: explorerTx(t.hash) })),
    };
    mkdirSync(path.resolve(__dirname, "..", "docs"), { recursive: true });
    const file = path.resolve(__dirname, "..", "docs", `e2e-${new URL(BASE).hostname.replace(/[^a-z0-9]/gi, "-")}.json`);
    writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`\nE2E PASSED — ${out.passed} checks, ${txs.length} transactions. Results: ${path.relative(process.cwd(), file)}`);
  })
  .catch((e) => {
    console.error(`\nE2E FAILED: ${e instanceof Error ? e.message : e}`);
    console.error(`  ${results.filter((r) => r.ok).length} checks passed before the failure; ${txs.length} transactions sent.`);
    process.exit(1);
  });
