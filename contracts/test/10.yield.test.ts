import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  baseFixture,
  makeParams,
  createProject,
  acceptCurrent,
  fundProject,
  activeProject,
  assertInvariants,
  milestoneStatus,
  vaultPending,
  ID_OFFSET,
  PS,
  MS,
  E,
  DAY,
  SUB,
  REASON,
  TERMS,
  hashOf,
  ParamOpts,
  Ctx,
} from "./helpers";
import type { EscrowFlow, MockMUSD } from "../typechain-types";

const PRECISION = 10n ** 36n;

async function yieldProject(ctx: Ctx, opts: Partial<ParamOpts> = {}) {
  return activeProject(ctx.escrow, ctx.musd, ctx.client, ctx.freelancer, {
    yieldEnabled: true,
    freelancerYieldBps: 5000,
    ...opts,
  });
}

async function setup(opts: Partial<ParamOpts> = {}) {
  const ctx = await loadFixture(baseFixture);
  const id = await yieldProject(ctx, opts);
  const escrowAddr = await ctx.escrow.getAddress();
  const inject = (amt: bigint) => ctx.vault.connect(ctx.deployer).receiveProtocolYield(amt);
  return { ...ctx, id, escrowAddr, inject };
}

describe("EscrowFlow · sMUSD yield: terms", () => {
  it("yield terms are agreed terms: YieldTermsSet after every TermsSet, edits bump the version", async () => {
    const { escrow, client, freelancer } = await loadFixture(baseFixture);
    const params = await makeParams({ freelancer: freelancer.address, yieldEnabled: true, freelancerYieldBps: 2500 });
    const tx = escrow.connect(client).createProject(params);
    const id = ID_OFFSET + 1n;
    await expect(tx).to.emit(escrow, "TermsSet");
    await expect(tx).to.emit(escrow, "YieldTermsSet").withArgs(id, 1, true, 2500);
    let y = await escrow.getYield(id);
    expect([y.enabled, y.freelancerBps, y.principal, y.accrued, y.paid]).to.deep.equal([true, 2500n, 0n, 0n, 0n]);

    await acceptCurrent(escrow, freelancer, id);
    // changing only the yield split is a terms change: version 2, acceptance reset
    const v2 = await makeParams({ freelancer: freelancer.address, yieldEnabled: true, freelancerYieldBps: 9000 });
    await expect(escrow.connect(client).updateTerms(id, v2)).to.emit(escrow, "YieldTermsSet").withArgs(id, 2, true, 9000);
    let p = await escrow.getProject(id);
    expect(p.termsVersion).to.equal(2n);
    expect(p.status).to.equal(PS.AwaitingAcceptance);
    await expect(escrow.connect(freelancer).acceptTerms(id, TERMS, 1)).to.be.revertedWithCustomError(escrow, "TermsMismatch");
    // switching yield off clears the split
    const v3 = await makeParams({ freelancer: freelancer.address });
    await expect(escrow.connect(client).updateTerms(id, v3)).to.emit(escrow, "YieldTermsSet").withArgs(id, 3, false, 0);
    y = await escrow.getYield(id);
    expect([y.enabled, y.freelancerBps]).to.deep.equal([false, 0n]);
    p = await escrow.getProject(id);
    expect(p.termsVersion).to.equal(3n);
  });

  it("InvalidYieldSplit: bps above 10000 with yield, or any bps without yield", async () => {
    const { escrow, client, freelancer } = await loadFixture(baseFixture);
    for (const o of [
      { yieldEnabled: true, freelancerYieldBps: 10_001 },
      { yieldEnabled: false, freelancerYieldBps: 1 },
    ]) {
      const params = await makeParams({ freelancer: freelancer.address, ...o });
      await expect(escrow.connect(client).createProject(params)).to.be.revertedWithCustomError(escrow, "InvalidYieldSplit");
    }
    for (const bps of [0, 10_000]) {
      const params = await makeParams({ freelancer: freelancer.address, yieldEnabled: true, freelancerYieldBps: bps });
      await expect(escrow.connect(client).createProject(params)).to.emit(escrow, "YieldTermsSet");
    }
  });

  it("YieldUnavailable when the registry was deployed without a savings vault", async () => {
    const { musd, client, freelancer } = await loadFixture(baseFixture);
    const escrow = (await ethers.deployContract("EscrowFlow", [
      await musd.getAddress(),
      ethers.ZeroAddress,
      ID_OFFSET,
    ])) as unknown as EscrowFlow;
    const params = await makeParams({ freelancer: freelancer.address, yieldEnabled: true });
    await expect(escrow.connect(client).createProject(params)).to.be.revertedWithCustomError(escrow, "YieldUnavailable");
    // plain projects work, and their yield view is empty
    const id = await activeProject(escrow, musd, client, freelancer);
    expect((await escrow.getYield(id)).enabled).to.equal(false);
    await expect(escrow.connect(client).distributeYield(id)).to.be.revertedWithCustomError(escrow, "YieldNotEnabled");
    await assertInvariants(escrow, musd);
  });
});

describe("EscrowFlow · sMUSD yield: funding", () => {
  it("fund deposits the exact total into sMUSD: SavingsDeposited, principal == held, no MUSD left idle", async () => {
    const ctx = await loadFixture(baseFixture);
    const { escrow, musd, vault, client, freelancer } = ctx;
    const escrowAddr = await escrow.getAddress();
    const id = await createProject(escrow, client, { freelancer: freelancer.address, yieldEnabled: true, freelancerYieldBps: 5000 });
    await acceptCurrent(escrow, freelancer, id);
    await musd.connect(client).approve(escrowAddr, E(200));
    const tx = escrow.connect(client).fund(id);
    await expect(tx).to.emit(escrow, "ProjectFunded").withArgs(id, client.address, E(200));
    await expect(tx).to.emit(escrow, "SavingsDeposited").withArgs(id, E(200));
    await expect(tx).to.changeTokenBalances(musd, [client, escrow, vault], [-E(200), 0n, E(200)]);
    expect(await vault.balanceOf(escrowAddr)).to.equal(E(200));
    expect(await musd.allowance(escrowAddr, await vault.getAddress())).to.equal(0n);
    const y = await escrow.getYield(id);
    expect(y.principal).to.equal(E(200));
    expect(y.accrued).to.equal(0n);
    expect(await escrow.totalYieldPrincipal()).to.equal(E(200));
    expect(await escrow.heldAmount(id)).to.equal(E(200));
    await assertInvariants(escrow, musd);
  });

  it("fundWithPermit deposits into sMUSD too", async () => {
    const { escrow, musd, vault, client, freelancer } = await loadFixture(baseFixture);
    const escrowAddr = await escrow.getAddress();
    const id = await createProject(escrow, client, { freelancer: freelancer.address, yieldEnabled: true });
    await acceptCurrent(escrow, freelancer, id);
    const deadline = BigInt(await time.latest()) + 3600n;
    const { chainId } = await ethers.provider.getNetwork();
    const sig = ethers.Signature.from(
      await client.signTypedData(
        { name: "Mezo USD", version: "1", chainId, verifyingContract: await musd.getAddress() },
        {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        { owner: client.address, spender: escrowAddr, value: E(200), nonce: await musd.nonces(client.address), deadline },
      ),
    );
    await expect(escrow.connect(client).fundWithPermit(id, deadline, sig.v, sig.r, sig.s))
      .to.emit(escrow, "SavingsDeposited")
      .withArgs(id, E(200));
    expect(await vault.balanceOf(escrowAddr)).to.equal(E(200));
    await assertInvariants(escrow, musd);
  });

  it("yield-disabled projects never touch the vault (v1 behaviour unchanged)", async () => {
    const ctx = await loadFixture(baseFixture);
    const { escrow, musd, vault, client, freelancer } = ctx;
    const escrowAddr = await escrow.getAddress();
    const id = await createProject(escrow, client, { freelancer: freelancer.address });
    await acceptCurrent(escrow, freelancer, id);
    await expect(fundProject(escrow, musd, client, id)).to.not.emit(escrow, "SavingsDeposited");
    expect(await musd.balanceOf(escrowAddr)).to.equal(E(200));
    expect(await vault.balanceOf(escrowAddr)).to.equal(0n);
    // a broken vault cannot affect a plain project
    await vault.setWithdrawBlocked(true);
    await vault.setClaimBlocked(true);
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    const tx = escrow.connect(client).approveAndRelease(id, 0);
    await expect(tx).to.not.emit(escrow, "SavingsWithdrawn");
    await expect(tx).to.changeTokenBalances(musd, [freelancer, escrow], [E(40), -E(40)]);
    await escrow.connect(client).proposeCancellation(id);
    await expect(escrow.connect(freelancer).acceptCancellation(id, E(160))).to.changeTokenBalances(musd, [client], [E(160)]);
    await expect(escrow.connect(client).distributeYield(id)).to.be.revertedWithCustomError(escrow, "YieldNotEnabled");
    const y = await escrow.getYield(id);
    expect(y.principal + y.accrued + y.paid).to.equal(0n);
    await assertInvariants(escrow, musd);
  });
});

describe("EscrowFlow · sMUSD yield: payouts", () => {
  it("release with yield accrued: the freelancer gets exactly the milestone, yield is credited to the project", async () => {
    const { escrow, musd, vault, client, freelancer, id, escrowAddr, inject } = await setup();
    await inject(E(10));
    expect((await escrow.getYield(id)).accrued).to.equal(E(10)); // estimate from vault views
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    const tx = escrow.connect(client).approveAndRelease(id, 0);
    await expect(tx).to.emit(escrow, "SavingsWithdrawn").withArgs(id, E(40));
    await expect(tx).to.emit(escrow, "YieldHarvested").withArgs(E(10));
    await expect(tx).to.emit(escrow, "MilestoneReleased");
    // vault pays 40 principal + 10 yield to the escrow, escrow pays exactly 40 to the freelancer
    await expect(tx).to.changeTokenBalances(musd, [freelancer, escrow, vault], [E(40), E(10), -E(50)]);
    const y = await escrow.getYield(id);
    expect(y.principal).to.equal(E(160));
    expect(y.accrued).to.equal(E(10));
    expect(await vault.balanceOf(escrowAddr)).to.equal(E(160));
    expect(await escrow.accYieldPerPrincipal()).to.equal((E(10) * PRECISION) / E(200));
    await assertInvariants(escrow, musd);
  });

  it("claimAfterReviewTimeout and reclaimExpiredMilestone pay out of the vault", async () => {
    const { escrow, musd, client, freelancer, id, inject } = await setup({ autoRelease: true, deadlineReclaim: true });
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await inject(E(2));
    await time.increase(3 * DAY);
    let tx = escrow.connect(freelancer).claimAfterReviewTimeout(id, 0);
    await expect(tx).to.emit(escrow, "SavingsWithdrawn").withArgs(id, E(40));
    await expect(tx).to.changeTokenBalances(musd, [freelancer], [E(40)]);
    await time.increase(365 * DAY);
    tx = escrow.connect(client).reclaimExpiredMilestone(id, 3);
    await expect(tx).to.emit(escrow, "SavingsWithdrawn").withArgs(id, E(40));
    await expect(tx).to.changeTokenBalances(musd, [client], [E(40)]);
    expect((await escrow.getYield(id)).principal).to.equal(E(120));
    expect((await escrow.getYield(id)).accrued).to.equal(E(2));
    await assertInvariants(escrow, musd);
  });

  it("settlement and arbiter rulings withdraw the full milestone, then split it", async () => {
    const { escrow, musd, client, freelancer, arbiter, id, inject } = await setup({ arbiter: (await ethers.getSigners())[4].address });
    await escrow.connect(freelancer).submitMilestone(id, 1, SUB());
    await escrow.connect(client).openDispute(id, 1, REASON);
    await escrow.connect(client).openDispute(id, 2, REASON);
    await inject(E(3));
    await escrow.connect(freelancer).proposeSettlement(id, 1, E(25));
    let tx = escrow.connect(client).acceptSettlement(id, 1, E(25));
    await expect(tx).to.emit(escrow, "SavingsWithdrawn").withArgs(id, E(60));
    await expect(tx).to.changeTokenBalances(musd, [freelancer, client], [E(25), E(35)]);
    tx = escrow.connect(arbiter).arbiterResolve(id, 2, E(60));
    await expect(tx).to.emit(escrow, "SavingsWithdrawn").withArgs(id, E(60));
    await expect(tx).to.changeTokenBalances(musd, [freelancer, client], [E(60), 0n]);
    expect((await escrow.getYield(id)).principal).to.equal(E(80));
    await assertInvariants(escrow, musd);
  });

  it("mutual cancellation: one vault withdrawal for the summed refund; a frozen dispute stays parked", async () => {
    const { escrow, musd, vault, client, freelancer, id, escrowAddr, inject } = await setup();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await escrow.connect(client).approveAndRelease(id, 0);
    await escrow.connect(freelancer).submitMilestone(id, 1, SUB(2));
    await escrow.connect(client).openDispute(id, 1, REASON);
    await inject(E(4));
    await escrow.connect(freelancer).proposeCancellation(id);
    const tx = escrow.connect(client).acceptCancellation(id, E(100));
    await expect(tx).to.emit(escrow, "SavingsWithdrawn").withArgs(id, E(100));
    await expect(tx).to.changeTokenBalances(musd, [client, freelancer], [E(100), 0n]);
    const receipt = await (await tx).wait();
    const withdrawals = receipt!.logs.filter((l) => {
      const ev = l.address === escrowAddr ? escrow.interface.parseLog(l) : null;
      return ev?.name === "SavingsWithdrawn";
    });
    expect(withdrawals.length).to.equal(1);
    expect((await escrow.getYield(id)).principal).to.equal(E(60));
    expect(await vault.balanceOf(escrowAddr)).to.equal(E(60));
    expect((await escrow.getProject(id)).status).to.equal(PS.Active);
    await assertInvariants(escrow, musd);
  });

  it("cancellation with nothing refundable makes no vault call", async () => {
    const { escrow, musd, client, freelancer, id } = await setup({ amounts: [E(10)] });
    await escrow.connect(client).openDispute(id, 0, REASON);
    await escrow.connect(freelancer).proposeCancellation(id);
    const tx = escrow.connect(client).acceptCancellation(id, 0);
    await expect(tx).to.emit(escrow, "ProjectCancelled").withArgs(id, client.address, 0n, true);
    await expect(tx).to.not.emit(escrow, "SavingsWithdrawn");
    await assertInvariants(escrow, musd);
  });
});

describe("EscrowFlow · sMUSD yield: distribution", () => {
  for (const [bps, label] of [
    [0, "0 bps: all yield to the client"],
    [10_000, "10000 bps: all yield to the freelancer"],
    [3333, "3333 bps: freelancer share rounds down, client gets the remainder"],
  ] as const) {
    it(`distributeYield split math — ${label}`, async () => {
      const { escrow, musd, client, freelancer, id, inject } = await setup({ freelancerYieldBps: bps });
      // the vault credits 200 MUSD of sMUSD in steps of 200 wei; +1400 wei makes the split non-integral
      const amt = E(10) + 1400n;
      await inject(amt);
      const accrued = (await escrow.getYield(id)).accrued;
      expect(accrued).to.equal(amt);
      const toFreelancer = (accrued * BigInt(bps)) / 10_000n;
      const toClient = accrued - toFreelancer;
      const tx = escrow.connect(freelancer).distributeYield(id);
      await expect(tx)
        .to.emit(escrow, "YieldDistributed")
        .withArgs(id, freelancer.address, toFreelancer, client.address, toClient);
      await expect(tx).to.changeTokenBalances(musd, [freelancer, client], [toFreelancer, toClient]);
      const y = await escrow.getYield(id);
      expect(y.accrued).to.equal(0n);
      expect(y.paid).to.equal(accrued);
      expect(y.principal).to.equal(E(200)); // principal untouched
      await expect(escrow.connect(client).distributeYield(id)).to.be.revertedWithCustomError(escrow, "NothingToDistribute");
      await assertInvariants(escrow, musd);
    });
  }

  it("only the parties may distribute; nothing before yield accrues", async () => {
    const { escrow, client, stranger, arbiter, id } = await setup({ arbiter: (await ethers.getSigners())[4].address });
    for (const s of [stranger, arbiter]) {
      await expect(escrow.connect(s).distributeYield(id)).to.be.revertedWithCustomError(escrow, "NotParty");
    }
    await expect(escrow.connect(client).distributeYield(id)).to.be.revertedWithCustomError(escrow, "NothingToDistribute");
  });

  it("yield earned while funds were held is distributable after completion and after cancellation", async () => {
    const ctx = await loadFixture(baseFixture);
    const { escrow, musd, vault, deployer, client, freelancer } = ctx;
    const done = await yieldProject(ctx, { amounts: [E(50)], freelancerYieldBps: 10_000 });
    const cancelled = await yieldProject(ctx, { amounts: [E(50)], freelancerYieldBps: 0 });
    await vault.connect(deployer).receiveProtocolYield(E(8));
    await escrow.connect(freelancer).submitMilestone(done, 0, SUB());
    await escrow.connect(client).approveAndRelease(done, 0);
    await escrow.connect(client).proposeCancellation(cancelled);
    await escrow.connect(freelancer).acceptCancellation(cancelled, E(50));
    expect((await escrow.getProject(done)).status).to.equal(PS.Completed);
    expect((await escrow.getProject(cancelled)).status).to.equal(PS.Cancelled);
    // late yield (after both principals left) cannot be attributed to them
    await vault.connect(deployer).receiveProtocolYield(E(1));
    await expect(escrow.connect(client).distributeYield(done)).to.changeTokenBalances(musd, [freelancer, client], [E(4), 0n]);
    await expect(escrow.connect(freelancer).distributeYield(cancelled)).to.changeTokenBalances(
      musd,
      [freelancer, client],
      [0n, E(4)],
    );
    expect((await escrow.getYield(done)).paid).to.equal(E(4));
    expect((await escrow.getYield(cancelled)).paid).to.equal(E(4));
    await assertInvariants(escrow, musd);
  });

  it("getYield's estimate matches what distributeYield then pays", async () => {
    const { escrow, client, id, inject, vault, escrowAddr } = await setup();
    await inject(E(3) + 12345n);
    await inject(E(1));
    const pending = await vaultPending(vault, escrowAddr);
    const est = (await escrow.getYield(id)).accrued;
    expect(est).to.equal(pending); // single project: its share is everything pending
    const tx = escrow.connect(client).distributeYield(id);
    const rc = await (await tx).wait();
    const ev = rc!.logs.map((l) => (l.address === escrowAddr ? escrow.interface.parseLog(l) : null)).find((e) => e?.name === "YieldDistributed");
    expect((ev!.args.freelancerAmount as bigint) + (ev!.args.clientAmount as bigint)).to.equal(est);
  });
});

describe("EscrowFlow · sMUSD yield: fair attribution across projects", () => {
  it("pro-rata by principal; a project funded later gets none of the yield accrued before it joined", async () => {
    const ctx = await loadFixture(baseFixture);
    const { escrow, musd, vault, deployer, client2, freelancer2 } = ctx;
    const a = await yieldProject(ctx, { amounts: [E(100)] });
    await vault.connect(deployer).receiveProtocolYield(E(10)); // all A's
    const b = await activeProject(escrow, musd, client2, freelancer2, { amounts: [E(300)], yieldEnabled: true });
    expect((await escrow.getYield(a)).accrued).to.equal(E(10));
    expect((await escrow.getYield(b)).accrued).to.equal(0n);
    await vault.connect(deployer).receiveProtocolYield(E(40)); // 1:3
    expect((await escrow.getYield(a)).accrued).to.equal(E(20));
    expect((await escrow.getYield(b)).accrued).to.equal(E(30));
    // harvest via distribution on A, then more yield: checkpoints keep B's share intact
    await escrow.connect(ctx.client).distributeYield(a);
    await vault.connect(deployer).receiveProtocolYield(E(4));
    expect((await escrow.getYield(a)).accrued).to.equal(E(1));
    expect((await escrow.getYield(b)).accrued).to.equal(E(33));
    await escrow.connect(client2).distributeYield(b);
    expect((await escrow.getYield(b)).paid).to.equal(E(33));
    await assertInvariants(escrow, musd);
  });

  it("a plain project funded in between does not dilute yield projects", async () => {
    const ctx = await loadFixture(baseFixture);
    const { escrow, musd, vault, deployer, client2, freelancer2 } = ctx;
    const a = await yieldProject(ctx, { amounts: [E(100)] });
    await activeProject(escrow, musd, client2, freelancer2, { amounts: [E(900)] });
    await vault.connect(deployer).receiveProtocolYield(E(5));
    expect((await escrow.getYield(a)).accrued).to.equal(E(5));
    await assertInvariants(escrow, musd);
  });

  it("yield the vault distributes inside the deposit call (MUSD PCV) belongs to the earlier depositors", async () => {
    const ctx = await loadFixture(baseFixture);
    const { escrow, musd, vault, deployer, client2, freelancer2 } = ctx;
    const a = await yieldProject(ctx, { amounts: [E(100)] });
    await vault.connect(deployer).queueProtocolYield(E(6)); // distributed at the start of the next deposit
    const b = await activeProject(escrow, musd, client2, freelancer2, { amounts: [E(100)], yieldEnabled: true });
    expect(await vault.queuedProtocolYield()).to.equal(0n);
    expect((await escrow.getYield(a)).accrued).to.equal(E(6));
    expect((await escrow.getYield(b)).accrued).to.equal(0n);
    // and inside a withdrawal it is split among everyone still parked at that moment
    await vault.connect(deployer).queueProtocolYield(E(2));
    await escrow.connect(ctx.freelancer).submitMilestone(a, 0, SUB());
    await escrow.connect(ctx.client).approveAndRelease(a, 0);
    expect((await escrow.getYield(a)).accrued).to.equal(E(7));
    expect((await escrow.getYield(b)).accrued).to.equal(E(1));
    await assertInvariants(escrow, musd);
  });

  it("yield harvested while no project principal is parked is unattributed (never credited to a later project)", async () => {
    const ctx = await loadFixture(baseFixture);
    const { escrow, musd, vault, deployer, stranger } = ctx;
    const escrowAddr = await escrow.getAddress();
    // someone donates sMUSD to the escrow while no yield project exists; it earns yield
    await musd.connect(stranger).approve(await vault.getAddress(), E(10));
    await vault.connect(stranger).deposit(E(10));
    await vault.connect(stranger).transfer(escrowAddr, E(10));
    await vault.connect(deployer).receiveProtocolYield(E(3));
    const id = await yieldProject(ctx, { amounts: [E(10)] });
    expect(await escrow.unattributedYield()).to.equal(E(3));
    expect((await escrow.getYield(id)).accrued).to.equal(0n);
    // later yield on the donated shares is shared by the parked principal (a bonus, never a loss)
    await vault.connect(deployer).receiveProtocolYield(E(2));
    expect((await escrow.getYield(id)).accrued).to.equal(E(2));
  });
});

describe("EscrowFlow · sMUSD yield: vault failures", () => {
  it("a vault that refuses withdrawals blocks yield payouts atomically; funds stay held; recovers when fixed", async () => {
    const { escrow, musd, vault, client, freelancer, arbiter, id, inject } = await setup({
      autoRelease: true,
      deadlineReclaim: true,
      arbiter: (await ethers.getSigners())[4].address,
    });
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await escrow.connect(client).openDispute(id, 1, REASON);
    await escrow.connect(client).proposeSettlement(id, 1, E(30));
    await escrow.connect(freelancer).proposeCancellation(id);
    await inject(E(1));
    await time.increase(365 * DAY);
    await vault.setWithdrawBlocked(true);
    const blocked = "MockSavingsVault: withdraw blocked";
    await expect(escrow.connect(client).approveAndRelease(id, 0)).to.be.revertedWith(blocked);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0)).to.be.revertedWith(blocked);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 2)).to.be.revertedWith(blocked);
    await expect(escrow.connect(freelancer).acceptSettlement(id, 1, E(30))).to.be.revertedWith(blocked);
    await expect(escrow.connect(arbiter).arbiterResolve(id, 1, E(10))).to.be.revertedWith(blocked);
    await expect(escrow.connect(client).acceptCancellation(id, E(140))).to.be.revertedWith(blocked);

    const p = await escrow.getProject(id);
    expect(p.cancelled).to.equal(false);
    expect(p.cancelProposer).to.equal(freelancer.address);
    expect(p.releasedAmount + p.refundedAmount).to.equal(0n);
    const ms = await escrow.getMilestones(id);
    expect(ms.map((m) => m.status)).to.deep.equal([MS.Submitted, MS.Disputed, MS.Pending, MS.Pending]);
    expect((await escrow.getYield(id)).principal).to.equal(E(200));
    expect(await escrow.heldAmount(id)).to.equal(E(200));
    await assertInvariants(escrow, musd);

    await vault.setWithdrawBlocked(false);
    await expect(escrow.connect(client).approveAndRelease(id, 0)).to.changeTokenBalances(musd, [freelancer], [E(40)]);
    expect(await milestoneStatus(escrow, id, 0)).to.equal(MS.Released);
    await assertInvariants(escrow, musd);
  });

  it("VaultShortfall: a vault returning less than the requested principal reverts the payout", async () => {
    const { escrow, musd, vault, client, freelancer, id, inject } = await setup();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await vault.setWithdrawShortfall(1n);
    await expect(escrow.connect(client).approveAndRelease(id, 0)).to.be.revertedWithCustomError(escrow, "VaultShortfall");
    // pending yield larger than the shortfall covers it: principal is made whole, yield absorbs the loss
    await inject(E(1));
    await expect(escrow.connect(client).approveAndRelease(id, 0)).to.changeTokenBalances(musd, [freelancer], [E(40)]);
    expect((await escrow.getYield(id)).accrued).to.equal(E(1) - 1n);
    await vault.setWithdrawShortfall(0n);
    await assertInvariants(escrow, musd);
  });

  it("VaultMismatch: a deposit that does not mint exactly the amount of sMUSD reverts funding", async () => {
    const { escrow, musd, vault, client, freelancer } = await loadFixture(baseFixture);
    const id = await createProject(escrow, client, { freelancer: freelancer.address, yieldEnabled: true });
    await acceptCurrent(escrow, freelancer, id);
    await musd.connect(client).approve(await escrow.getAddress(), E(200));
    await vault.setDepositUnderMint(1n);
    await expect(escrow.connect(client).fund(id)).to.be.revertedWithCustomError(escrow, "VaultMismatch");
    expect((await escrow.getProject(id)).status).to.equal(PS.AwaitingFunding);
    await vault.setDepositUnderMint(0n);
    await expect(escrow.connect(client).fund(id)).to.emit(escrow, "SavingsDeposited");
  });

  it("a vault whose claimYield fails blocks funding and distribution of yield projects only", async () => {
    const ctx = await loadFixture(baseFixture);
    const { escrow, musd, vault, client, freelancer } = ctx;
    const live = await yieldProject(ctx);
    const id = await createProject(escrow, client, { freelancer: freelancer.address, yieldEnabled: true });
    await acceptCurrent(escrow, freelancer, id);
    await musd.connect(client).approve(await escrow.getAddress(), E(200));
    await vault.setClaimBlocked(true);
    await expect(escrow.connect(client).fund(id)).to.be.revertedWith("MockSavingsVault: claim blocked");
    await expect(escrow.connect(client).distributeYield(live)).to.be.revertedWith("MockSavingsVault: claim blocked");
    expect((await escrow.getProject(id)).status).to.equal(PS.AwaitingFunding);
    // plain projects are unaffected
    await expect(activeProject(escrow, musd, client, freelancer)).to.not.be.reverted;
    await vault.setClaimBlocked(false);
    await musd.connect(client).approve(await escrow.getAddress(), E(200));
    await expect(escrow.connect(client).fund(id)).to.emit(escrow, "SavingsDeposited");
    await assertInvariants(escrow, musd);
  });
});

describe("EscrowFlow · sMUSD yield: reentrancy", () => {
  it("re-entering distributeYield from a payout transfer hook is blocked", async () => {
    const [, client, freelancer] = await ethers.getSigners();
    const token = (await ethers.deployContract("ReentrantToken")) as any;
    const vault = await ethers.deployContract("MockSavingsVault", [await token.getAddress()]);
    const escrow = (await ethers.deployContract("EscrowFlow", [
      await token.getAddress(),
      await vault.getAddress(),
      ID_OFFSET,
    ])) as unknown as EscrowFlow;
    const proxy = await ethers.deployContract("PartyProxy");
    const escrowAddr = await escrow.getAddress();
    const proxyAddr = await proxy.getAddress();
    await token.mint(client.address, E(1000));
    await token.mint(proxyAddr, E(1000));
    // the freelancer is a contract wallet that tries to grab yield again mid-transfer
    const id = await createProject(escrow, client, { freelancer: proxyAddr, yieldEnabled: true, freelancerYieldBps: 5000 });
    const p = await escrow.getProject(id);
    await proxy.exec(escrowAddr, escrow.interface.encodeFunctionData("acceptTerms", [id, p.termsHash, p.termsVersion]));
    await fundProject(escrow, token, client, id);
    await token.connect(client).approve(await vault.getAddress(), E(10));
    await vault.connect(client).receiveProtocolYield(E(10));
    await proxy.setHook(escrowAddr, escrow.interface.encodeFunctionData("distributeYield", [id]));
    await token.arm(proxyAddr, proxy.interface.encodeFunctionData("hook"));
    await expect(proxy.exec(escrowAddr, escrow.interface.encodeFunctionData("distributeYield", [id]))).to.changeTokenBalances(
      token,
      [proxy, client],
      [E(5), E(5)],
    );
    expect(await proxy.hookSuccess()).to.equal(false);
    expect(await proxy.hookReturn()).to.equal(ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10));
    expect((await escrow.getYield(id)).paid).to.equal(E(10));
    void freelancer;
    void hashOf;
    void (null as unknown as MockMUSD);
  });
});
