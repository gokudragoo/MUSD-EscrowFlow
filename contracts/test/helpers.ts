import { ethers } from "hardhat";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { EscrowFlow, MockMUSD, MockSavingsVault } from "../typechain-types";

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
/** Production id offset: v2 ids start at 1001 so they never collide with the legacy v1 registry. */
export const ID_OFFSET = 1000n;
/** n-th project id of a registry deployed with ID_OFFSET (1-based). */
export const pid = (n: number | bigint) => ID_OFFSET + BigInt(n);

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
  yieldEnabled?: boolean;
  freelancerYieldBps?: number | bigint;
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
  yieldEnabled: boolean;
  freelancerYieldBps: number | bigint;
}

/** Builds a ProjectParams struct. Defaults: spec milestones 40/60/60/40, deadlines 30d+7d*i, 3-day review, 1-day grace, no yield. */
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
    yieldEnabled: o.yieldEnabled ?? false,
    freelancerYieldBps: o.freelancerYieldBps ?? 0,
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
  const vault = (await ethers.deployContract("MockSavingsVault", [await musd.getAddress()])) as unknown as MockSavingsVault;
  const escrow = (await ethers.deployContract("EscrowFlow", [
    await musd.getAddress(),
    await vault.getAddress(),
    ID_OFFSET,
  ])) as unknown as EscrowFlow;
  for (const s of [client, client2, freelancer, freelancer2, stranger, arbiter]) {
    await musd.mint(s.address, E(100_000));
  }
  // The deployer plays the MUSD protocol (PCV) and pushes savings yield into the vault.
  await musd.mint(deployer.address, E(1_000_000));
  await musd.connect(deployer).approve(await vault.getAddress(), ethers.MaxUint256);
  return { deployer, client, freelancer, stranger, arbiter, freelancer2, client2, broke, musd, vault, escrow };
}

export type Ctx = Awaited<ReturnType<typeof baseFixture>>;

/** Deploys an EscrowFlow (no savings vault) bound to an arbitrary (possibly adversarial) token contract. */
export async function deployWithToken(tokenName: string, args: unknown[] = []) {
  const [deployer, client, freelancer, stranger, arbiter] = await ethers.getSigners();
  const token = (await ethers.deployContract(tokenName, args)) as any;
  const escrow = (await ethers.deployContract("EscrowFlow", [
    await token.getAddress(),
    ethers.ZeroAddress,
    ID_OFFSET,
  ])) as unknown as EscrowFlow;
  for (const s of [client, freelancer, stranger]) await token.mint(s.address, E(100_000));
  return { deployer, client, freelancer, stranger, arbiter, token, escrow };
}

// ---------------------------------------------------------------------------
// Flow helpers
// ---------------------------------------------------------------------------
/** Id of the most recently created project (ID_OFFSET + projectCount). */
export async function lastId(escrow: EscrowFlow): Promise<bigint> {
  return (await escrow.ID_OFFSET()) + (await escrow.projectCount());
}

/** All project ids of the registry, in creation order. */
export async function allIds(escrow: EscrowFlow): Promise<bigint[]> {
  const offset = await escrow.ID_OFFSET();
  const count = await escrow.projectCount();
  return Array.from({ length: Number(count) }, (_, i) => offset + BigInt(i + 1));
}

export async function createProject(escrow: EscrowFlow, client: Signer, opts: ParamOpts): Promise<bigint> {
  const params = await makeParams(opts);
  await escrow.connect(client).createProject(params);
  return lastId(escrow);
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

/** Refund an acceptCancellation would execute now: Σ amounts of Pending / Submitted / ChangesRequested milestones. */
export async function cancellationRefund(escrow: EscrowFlow, id: bigint): Promise<bigint> {
  const ms = await escrow.getMilestones(id);
  return ms
    .filter((m) => m.status === MS.Pending || m.status === MS.Submitted || m.status === MS.ChangesRequested)
    .reduce((a, m) => a + m.amount, 0n);
}

/** Yield the vault has credited to `who` but not paid out yet (mirrors MUSDSavingsRate's math). */
export async function vaultPending(vault: MockSavingsVault, who: string): Promise<bigint> {
  const bal = await vault.balanceOf(who);
  return (await vault.claimableYield(who)) + (bal * ((await vault.yieldIndex()) - (await vault.supplyYieldIndex(who)))) / E(1);
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
 *  - totalHeld == Σ held; token.balanceOf(escrow) >= totalHeld (no vault)
 * Savings yield (registry with a vault):
 *  - yield project: vault principal == held; non-yield project: principal == accrued == paid == 0
 *  - totalYieldPrincipal == Σ principal == sMUSD.balanceOf(escrow)
 *  - totalHeld − totalYieldPrincipal <= token.balanceOf(escrow)
 *  - token + sMUSD (+ yield the vault still owes the escrow) >= totalHeld + Σ undistributed accrued yield;
 *    when nothing is pending in the vault this is exactly token + sMUSD >= totalHeld + Σ accrued.
 */
export async function assertInvariants(escrow: EscrowFlow, token: TokenLike) {
  const escrowAddr = await escrow.getAddress();
  const vaultAddr = await escrow.savingsVault();
  const hasVault = vaultAddr !== ethers.ZeroAddress;
  let sumHeld = 0n;
  let sumPrincipal = 0n;
  let sumAccrued = 0n;
  for (const id of await allIds(escrow)) {
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

    const y = await escrow.getYield(id);
    if (y.enabled) {
      expect(y.principal, `${tag}: vault principal == held`).to.equal(held);
    } else {
      expect(y.principal + y.accrued + y.paid, `${tag}: no yield without opt-in`).to.equal(0n);
    }
    sumPrincipal += y.principal;
    sumAccrued += y.accrued;
  }
  expect(await escrow.totalHeld(), "totalHeld == Σ held").to.equal(sumHeld);
  const tokenBal = await token.balanceOf(escrowAddr);
  expect(await escrow.totalYieldPrincipal(), "totalYieldPrincipal == Σ principal").to.equal(sumPrincipal);
  expect(sumHeld - sumPrincipal, "un-parked held funds are in the escrow").to.be.lte(tokenBal);
  if (hasVault) {
    const vault = (await ethers.getContractAt("MockSavingsVault", vaultAddr)) as unknown as MockSavingsVault;
    const shares = await vault.balanceOf(escrowAddr);
    expect(shares, "sMUSD.balanceOf(escrow) == totalYieldPrincipal").to.equal(sumPrincipal);
    const pending = await vaultPending(vault, escrowAddr);
    expect(tokenBal + shares + pending, "escrow assets cover held + undistributed yield").to.be.gte(sumHeld + sumAccrued);
    if (pending === 0n) {
      expect(tokenBal + shares, "token + sMUSD >= totalHeld + Σ accrued").to.be.gte(sumHeld + sumAccrued);
    }
  } else {
    expect(tokenBal, "escrow balance covers totalHeld").to.be.gte(sumHeld);
  }
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
