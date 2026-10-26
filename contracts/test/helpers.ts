import { ethers } from "hardhat";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { EscrowFlow, MockMUSD } from "../typechain-types";

// ---------------------------------------------------------------------------
// Enum mirrors (must match EscrowFlow.sol ordering)
// ---------------------------------------------------------------------------
export const PS = {
  None: 0n,
  AwaitingAcceptance: 1n,
  AwaitingFunding: 2n,
  Active: 3n,
  Completed: 4n,
  Cancelled: 5n,
} as const;

export const MS = {
  Pending: 0n,
  Submitted: 1n,
  ChangesRequested: 2n,
  Disputed: 3n,
  Released: 4n,
  Refunded: 5n,
  Resolved: 6n,
} as const;

export const ReleaseKind = { ClientApproval: 0n, ReviewTimeout: 1n } as const;
export const RefundKind = { DeadlineReclaim: 0n, MutualCancellation: 1n } as const;
export const ResolutionKind = { MutualSettlement: 0n, Arbiter: 1n } as const;

// ---------------------------------------------------------------------------
// Units & constants
// ---------------------------------------------------------------------------
export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86_400;
export const E = (n: number | string) => ethers.parseUnits(String(n), 18);
export const hashOf = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));
export const TERMS = hashOf("terms-document-v1");
export const SUB = (n = 1) => hashOf(`submission-${n}`);
export const REASON = hashOf("acceptance criteria 2 and 3 unmet");
export const SPEC_AMOUNTS = [E(40), E(60), E(60), E(40)];

export type Signer = HardhatEthersSigner;

export interface ParamOpts {
  freelancer: string;
  arbiter?: string;
  termsHash?: string;
  autoRelease?: boolean;
  deadlineReclaim?: boolean;
  reclaimGracePeriod?: number | bigint;
  amounts?: bigint[];
  deadlines?: bigint[];
  reviewPeriods?: (number | bigint)[];
}

export interface ProjectParamsStruct {
  freelancer: string;
  arbiter: string;
  termsHash: string;
  autoRelease: boolean;
  deadlineReclaim: boolean;
  reclaimGracePeriod: number | bigint;
  amounts: bigint[];
  deadlines: bigint[];
  reviewPeriods: (number | bigint)[];
}

/** Builds a ProjectParams struct. Defaults: spec milestones 40/60/60/40, deadlines 30d+7d*i, 3-day review, 1-day grace. */
export async function makeParams(o: ParamOpts): Promise<ProjectParamsStruct> {
  const now = BigInt(await time.latest());
  const amounts = o.amounts ?? SPEC_AMOUNTS;
  const deadlines = o.deadlines ?? amounts.map((_, i) => now + BigInt((30 + i * 7) * DAY));
  const reviewPeriods = o.reviewPeriods ?? amounts.map(() => 3 * DAY);
  return {
    freelancer: o.freelancer,
    arbiter: o.arbiter ?? ethers.ZeroAddress,
    termsHash: o.termsHash ?? TERMS,
    autoRelease: o.autoRelease ?? false,
    deadlineReclaim: o.deadlineReclaim ?? false,
    reclaimGracePeriod: o.reclaimGracePeriod ?? DAY,
    amounts,
    deadlines,
    reviewPeriods,
  };
}

// Minimal token surface shared by MockMUSD and the adversarial mocks.
export interface TokenLike {
  getAddress(): Promise<string>;
  balanceOf(a: string): Promise<bigint>;
  connect(s: Signer): any;
  mint(to: string, amount: bigint): Promise<any>;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
export async function baseFixture() {
  const [deployer, client, freelancer, stranger, arbiter, freelancer2, client2, broke] = await ethers.getSigners();
  const musd = (await ethers.deployContract("MockMUSD")) as unknown as MockMUSD;
  const escrow = (await ethers.deployContract("EscrowFlow", [await musd.getAddress()])) as unknown as EscrowFlow;
  for (const s of [client, client2, freelancer, freelancer2, stranger, arbiter]) {
    await musd.mint(s.address, E(100_000));
  }
  return { deployer, client, freelancer, stranger, arbiter, freelancer2, client2, broke, musd, escrow };
}

export type Ctx = Awaited<ReturnType<typeof baseFixture>>;

/** Deploys an EscrowFlow bound to an arbitrary (possibly adversarial) token contract. */
export async function deployWithToken(tokenName: string, args: unknown[] = []) {
  const [deployer, client, freelancer, stranger, arbiter] = await ethers.getSigners();
  const token = (await ethers.deployContract(tokenName, args)) as any;
  const escrow = (await ethers.deployContract("EscrowFlow", [await token.getAddress()])) as unknown as EscrowFlow;
  for (const s of [client, freelancer, stranger]) await token.mint(s.address, E(100_000));
  return { deployer, client, freelancer, stranger, arbiter, token, escrow };
}

// ---------------------------------------------------------------------------
// Flow helpers
// ---------------------------------------------------------------------------
export async function createProject(escrow: EscrowFlow, client: Signer, opts: ParamOpts): Promise<bigint> {
  const params = await makeParams(opts);
  await escrow.connect(client).createProject(params);
  return escrow.projectCount();
}

export async function acceptCurrent(escrow: EscrowFlow, freelancer: Signer, id: bigint) {
  const p = await escrow.getProject(id);
  return escrow.connect(freelancer).acceptTerms(id, p.termsHash, p.termsVersion);
}

export async function fundProject(escrow: EscrowFlow, token: TokenLike, client: Signer, id: bigint) {
  const p = await escrow.getProject(id);
  await token.connect(client).approve(await escrow.getAddress(), p.totalAmount);
  return escrow.connect(client).fund(id);
}

/** Create → accept → fund. Returns the project id. */
export async function activeProject(
  escrow: EscrowFlow,
  token: TokenLike,
  client: Signer,
  freelancer: Signer,
  opts: Partial<ParamOpts> = {},
): Promise<bigint> {
  const id = await createProject(escrow, client, { freelancer: freelancer.address, ...opts });
  await acceptCurrent(escrow, freelancer, id);
  await fundProject(escrow, token, client, id);
  return id;
}

export async function milestoneStatus(escrow: EscrowFlow, id: bigint, i: number | bigint) {
  return (await escrow.getMilestone(id, i)).status;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------
/**
 * Global escrow accounting invariants, checked across EVERY project in the registry:
 *  - per project: fundedAmount == releasedAmount + refundedAmount + heldAmount
 *  - per project: Σ milestone.released == releasedAmount, Σ milestone.refunded == refundedAmount
 *  - terminal milestones: released + refunded == amount; live milestones: both 0
 *  - funded projects: held == Σ amounts of live (non-terminal) milestones; fundedAmount == totalAmount
 *  - openDisputes == number of Disputed milestones
 *  - Completed/Cancelled ⇒ held == 0; Active ⇒ held > 0
 *  - totalHeld == Σ held; token.balanceOf(escrow) >= totalHeld
 */
export async function assertInvariants(escrow: EscrowFlow, token: TokenLike) {
  const count = await escrow.projectCount();
  let sumHeld = 0n;
  for (let id = 1n; id <= count; id++) {
    const p = await escrow.getProject(id);
    const ms = await escrow.getMilestones(id);
    const held = await escrow.heldAmount(id);
    const tag = `project ${id}`;

    expect(p.fundedAmount, `${tag}: funded == released + refunded + held`).to.equal(
      p.releasedAmount + p.refundedAmount + held,
    );

    let rel = 0n;
    let ref = 0n;
    let total = 0n;
    let live = 0n;
    let disputed = 0n;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      rel += m.releasedAmount;
      ref += m.refundedAmount;
      total += m.amount;
      if (m.status >= MS.Released) {
        expect(m.releasedAmount + m.refundedAmount, `${tag} m${i}: terminal settles full amount`).to.equal(m.amount);
        if (m.status === MS.Released) expect(m.refundedAmount).to.equal(0n);
        if (m.status === MS.Refunded) expect(m.releasedAmount).to.equal(0n);
      } else {
        expect(m.releasedAmount, `${tag} m${i}: live milestone has no payout`).to.equal(0n);
        expect(m.refundedAmount, `${tag} m${i}: live milestone has no refund`).to.equal(0n);
        live += m.amount;
      }
      if (m.status === MS.Disputed) disputed += 1n;
    }
    expect(total, `${tag}: totalAmount == Σ milestones`).to.equal(p.totalAmount);
    expect(rel, `${tag}: Σ released`).to.equal(p.releasedAmount);
    expect(ref, `${tag}: Σ refunded`).to.equal(p.refundedAmount);
    expect(BigInt(p.openDisputes), `${tag}: openDisputes`).to.equal(disputed);

    if (p.fundedAmount > 0n) {
      expect(p.fundedAmount, `${tag}: funded == total`).to.equal(p.totalAmount);
      expect(held, `${tag}: held == Σ live`).to.equal(live);
    } else {
      expect(rel + ref, `${tag}: unfunded project never paid`).to.equal(0n);
    }
    if (p.status === PS.Completed || p.status === PS.Cancelled) expect(held, `${tag}: closed ⇒ held 0`).to.equal(0n);
    if (p.status === PS.Active) expect(held > 0n, `${tag}: active ⇒ held > 0`).to.equal(true);
    sumHeld += held;
  }
  expect(await escrow.totalHeld(), "totalHeld == Σ held").to.equal(sumHeld);
  expect(await token.balanceOf(await escrow.getAddress()), "escrow balance covers totalHeld").to.be.gte(sumHeld);
}

/** Deterministic PRNG (mulberry32) for reproducible fuzz sequences. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const REENTRANCY_SELECTOR = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);
