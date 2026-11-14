import { ethers, network } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  baseFixture,
  deployWithToken,
  makeParams,
  createProject,
  activeProject,
  assertInvariants,
  milestoneStatus,
  ID_OFFSET,
  PS,
  MS,
  E,
  DAY,
  HOUR,
  SUB,
  REASON,
  ParamOpts,
} from "./helpers";
import type { EscrowFlow } from "../typechain-types";

async function funded(opts: Partial<ParamOpts> = {}) {
  const ctx = await loadFixture(baseFixture);
  const id = await activeProject(ctx.escrow, ctx.musd, ctx.client, ctx.freelancer, opts);
  return { ...ctx, id };
}

const blockTime = async (tx: { blockNumber: number | null }) =>
  BigInt((await ethers.provider.getBlock(tx.blockNumber!))!.timestamp);

describe("EscrowFlow v2 · A. project id offset", () => {
  it("ids are ID_OFFSET + n, projectCount stays the count, events and indexes carry the real id", async () => {
    const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
    const params = await makeParams({ freelancer: freelancer.address });
    await expect(escrow.connect(client).createProject(params))
      .to.emit(escrow, "ProjectCreated")
      .withArgs(1001n, client.address, freelancer.address);
    const id2 = await activeProject(escrow, musd, client, freelancer);
    expect(id2).to.equal(1002n);
    expect(await escrow.projectCount()).to.equal(2n);
    expect(await escrow.projectsOfClient(client.address)).to.deep.equal([1001n, 1002n]);
    expect(await escrow.projectsOfFreelancer(freelancer.address)).to.deep.equal([1001n, 1002n]);
    expect((await escrow.getProject(1002n)).status).to.equal(PS.Active);
    for (const legacy of [0n, 1n, 4n, ID_OFFSET]) {
      await expect(escrow.getProject(legacy)).to.be.revertedWithCustomError(escrow, "ProjectNotFound").withArgs(legacy);
    }
  });

  it("an offset of 0 reproduces v1 numbering (1, 2, …)", async () => {
    const { musd, client, freelancer } = await loadFixture(baseFixture);
    const escrow = (await ethers.deployContract("EscrowFlow", [
      await musd.getAddress(),
      ethers.ZeroAddress,
      0,
    ])) as unknown as EscrowFlow;
    expect(await createProject(escrow, client, { freelancer: freelancer.address })).to.equal(1n);
    expect(await escrow.projectsOfClient(client.address)).to.deep.equal([1n]);
  });
});

describe("EscrowFlow v2 · B1. withdrawDispute cannot feed a cancellation sweep", () => {
  /** M0 submitted and disputed by the client; the freelancer then proposes cancellation (expecting M1..M3 = 160 back to the client). */
  async function exploitSetup() {
    const ctx = await funded({ arbiter: (await ethers.getSigners())[4].address });
    const { escrow, client, freelancer, id } = ctx;
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await escrow.connect(client).openDispute(id, 0, REASON);
    await escrow.connect(freelancer).proposeCancellation(id);
    return ctx;
  }

  it("exploit (sequential): withdrawDispute clears the proposal, so the submitted M0 can no longer be swept", async () => {
    const { escrow, musd, client, freelancer, id } = await exploitSetup();
    await expect(escrow.connect(client).withdrawDispute(id, 0))
      .to.emit(escrow, "CancellationRevoked")
      .withArgs(id, client.address);
    expect((await escrow.getProject(id)).cancelProposer).to.equal(ethers.ZeroAddress);
    await expect(escrow.connect(client).acceptCancellation(id, E(200))).to.be.revertedWithCustomError(
      escrow,
      "NoCancellationProposal",
    );
    expect(await milestoneStatus(escrow, id, 0)).to.equal(MS.Submitted);
    expect(await escrow.heldAmount(id)).to.equal(E(200));
    // the freelancer's submitted work is still payable to them
    await expect(escrow.connect(client).approveAndRelease(id, 0)).to.changeTokenBalances(musd, [freelancer], [E(40)]);
    await assertInvariants(escrow, musd);
  });

  it("exploit (same block): withdrawDispute + acceptCancellation mined together — the sweep reverts", async () => {
    const { escrow, musd, client, id } = await exploitSetup();
    const clientBefore = await musd.balanceOf(client.address);
    await network.provider.send("evm_setAutomine", [false]);
    let withdrawTx;
    let sweepTx;
    try {
      withdrawTx = await escrow.connect(client).withdrawDispute(id, 0, { gasLimit: 500_000 });
      sweepTx = await escrow.connect(client).acceptCancellation(id, E(200), { gasLimit: 1_000_000 });
      await network.provider.send("evm_mine");
    } finally {
      await network.provider.send("evm_setAutomine", [true]);
    }
    const r1 = await ethers.provider.getTransactionReceipt(withdrawTx!.hash);
    const r2 = await ethers.provider.getTransactionReceipt(sweepTx!.hash);
    expect(r1!.blockNumber).to.equal(r2!.blockNumber);
    expect(r1!.status).to.equal(1);
    expect(r2!.status).to.equal(0); // NoCancellationProposal
    expect(await musd.balanceOf(client.address)).to.equal(clientBefore); // no refund was executed
    expect(await milestoneStatus(escrow, id, 0)).to.equal(MS.Submitted);
    expect((await escrow.getProject(id)).cancelled).to.equal(false);
    expect(await escrow.heldAmount(id)).to.equal(E(200));
  });

  it("even with a fresh proposal, acceptCancellation only executes the exact refund the acceptor agreed to", async () => {
    const { escrow, musd, client, freelancer, id } = await exploitSetup();
    // Freelancer's proposal stands while M0 is disputed: the agreed refund is M1..M3 = 160.
    await expect(escrow.connect(client).acceptCancellation(id, E(200)))
      .to.be.revertedWithCustomError(escrow, "RefundMismatch")
      .withArgs(E(160));
    await expect(escrow.connect(client).acceptCancellation(id, E(160)))
      .to.emit(escrow, "ProjectCancelled")
      .withArgs(id, client.address, E(160), true);
    expect(await milestoneStatus(escrow, id, 0)).to.equal(MS.Disputed); // frozen, cannot be withdrawn now
    await expect(escrow.connect(client).withdrawDispute(id, 0)).to.be.revertedWithCustomError(
      escrow,
      "DisputeLockedByCancellation",
    );
    await assertInvariants(escrow, musd);
    void freelancer;
  });

  it("openDispute also withdraws a pending cancellation proposal (CancellationRevoked by the disputer)", async () => {
    const { escrow, client, freelancer, id } = await funded();
    await escrow.connect(freelancer).proposeCancellation(id);
    await expect(escrow.connect(client).openDispute(id, 2, REASON))
      .to.emit(escrow, "CancellationRevoked")
      .withArgs(id, client.address);
    expect((await escrow.getProject(id)).cancelProposer).to.equal(ethers.ZeroAddress);
    await expect(escrow.connect(client).acceptCancellation(id, E(140))).to.be.revertedWithCustomError(
      escrow,
      "NoCancellationProposal",
    );
    // no proposal pending → no revocation event
    await expect(escrow.connect(client).withdrawDispute(id, 2)).to.not.emit(escrow, "CancellationRevoked");
  });

  it("RefundMismatch(actual) guards the acceptor against the refundable set changing before inclusion", async () => {
    const { escrow, musd, client, freelancer, id } = await funded({ deadlineReclaim: true });
    await escrow.connect(client).proposeCancellation(id);
    // freelancer signs an acceptance for the full 200 …
    await expect(escrow.connect(freelancer).acceptCancellation(id, 0))
      .to.be.revertedWithCustomError(escrow, "RefundMismatch")
      .withArgs(E(200));
    // … but M0 expires and the client reclaims it first: the refund is now 160.
    const m0 = await escrow.getMilestone(id, 0);
    await time.increaseTo(m0.deadline + BigInt(DAY) + 1n);
    await escrow.connect(client).reclaimExpiredMilestone(id, 0);
    await expect(escrow.connect(freelancer).acceptCancellation(id, E(200)))
      .to.be.revertedWithCustomError(escrow, "RefundMismatch")
      .withArgs(E(160));
    await expect(escrow.connect(freelancer).acceptCancellation(id, E(160))).to.changeTokenBalances(musd, [client], [E(160)]);
    await assertInvariants(escrow, musd);
  });
});

describe("EscrowFlow v2 · B2/B3. dispute time never runs a clock against the other party", () => {
  it("exploit: dispute/withdraw cycles no longer postpone auto-release (submittedAt shifts by the pause, not to now)", async () => {
    const { escrow, musd, client, freelancer, id } = await funded({ autoRelease: true });
    const sub = await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    const submittedAt = await blockTime(sub);
    const R = BigInt(3 * DAY);
    let paused = 0n;
    // ten seconds before the window vests, the client starts dispute/withdraw cycles
    await time.increaseTo(submittedAt + R - 10n);
    for (let cycle = 0; cycle < 5; cycle++) {
      const open = await escrow.connect(client).openDispute(id, 0, REASON);
      await time.increase(3);
      const w = await escrow.connect(client).withdrawDispute(id, 0);
      const d = (await blockTime(w)) - (await blockTime(open));
      await expect(w).to.emit(escrow, "DisputeWithdrawn").withArgs(id, 0n, client.address, d);
      paused += d;
    }
    const m = await escrow.getMilestone(id, 0);
    expect(m.pausedFor).to.equal(paused);
    expect(m.submittedAt).to.equal(submittedAt + paused);
    const dueAt = submittedAt + paused + R;
    expect(await escrow.reviewDeadline(id, 0)).to.equal(dueAt);
    expect(paused).to.be.lt(60n); // v1 would have pushed the deadline out by ~5 × 3 days
    await time.setNextBlockTimestamp(dueAt);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0)).to.changeTokenBalances(musd, [freelancer], [E(40)]);
    // and once vested, the client can no longer dispute it
    await assertInvariants(escrow, musd);
  });

  it("the client keeps only the review time that was left when they disputed (vested windows stay vested)", async () => {
    const { escrow, client, freelancer, id } = await funded({ autoRelease: true });
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    const submittedAt = (await escrow.getMilestone(id, 0)).submittedAt;
    await time.increaseTo(submittedAt + BigInt(2 * DAY));
    await escrow.connect(client).openDispute(id, 0, REASON); // 1 day left
    await time.increase(20 * DAY);
    await escrow.connect(client).withdrawDispute(id, 0);
    const now = BigInt(await time.latest());
    const due = await escrow.reviewDeadline(id, 0);
    expect(due - now).to.equal(BigInt(DAY) - 1n);
    await time.setNextBlockTimestamp(due);
    await expect(escrow.connect(client).requestChanges(id, 0, REASON)).to.be.revertedWithCustomError(
      escrow,
      "ReviewWindowElapsed",
    );
    await expect(escrow.connect(client).openDispute(id, 0, REASON)).to.be.revertedWithCustomError(
      escrow,
      "ReviewWindowElapsed",
    );
  });

  it("a freelancer-initiated dispute on vested work does not reopen the client's window on withdrawal", async () => {
    const { escrow, client, freelancer, id } = await funded({ autoRelease: true });
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await time.increase(4 * DAY); // vested
    await escrow.connect(freelancer).openDispute(id, 0, REASON);
    await time.increase(10 * DAY);
    await escrow.connect(freelancer).withdrawDispute(id, 0);
    expect(await escrow.reviewDeadline(id, 0)).to.be.lte(BigInt(await time.latest()));
    await expect(escrow.connect(client).requestChanges(id, 0, REASON)).to.be.revertedWithCustomError(
      escrow,
      "ReviewWindowElapsed",
    );
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0)).to.emit(escrow, "MilestoneReleased");
  });

  it("exploit: a dispute held past deadline + grace no longer makes a Pending milestone reclaimable on withdrawal", async () => {
    const { escrow, musd, client, freelancer, id } = await funded({ deadlineReclaim: true, reclaimGracePeriod: DAY });
    const deadline = (await escrow.getMilestone(id, 0)).deadline;
    // client freezes M0 five days before its deadline and sits on the dispute for 30 days
    await time.increaseTo(deadline - BigInt(5 * DAY));
    const open = await escrow.connect(client).openDispute(id, 0, REASON);
    await time.increase(30 * DAY);
    const w = await escrow.connect(client).withdrawDispute(id, 0);
    const paused = (await blockTime(w)) - (await blockTime(open));
    const m = await escrow.getMilestone(id, 0);
    expect(m.deadline).to.equal(deadline); // the agreed term is untouched
    expect(m.pausedFor).to.equal(paused);
    const availableAt = deadline + paused + BigInt(DAY);
    expect(await escrow.reclaimAvailableAt(id, 0)).to.equal(availableAt);
    // v1: reclaimable immediately. v2: the freelancer still has the 5 days (+ grace) that were left.
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0))
      .to.be.revertedWithCustomError(escrow, "ReclaimNotYetAvailable")
      .withArgs(availableAt);
    await time.increase(4 * DAY);
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await time.increaseTo(availableAt + 1n);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Submitted);
    await assertInvariants(escrow, musd);
  });

  it("reclaim becomes available exactly after deadline + pausedFor + grace when nothing is delivered", async () => {
    const { escrow, musd, client, id } = await funded({ deadlineReclaim: true, reclaimGracePeriod: HOUR });
    const deadline = (await escrow.getMilestone(id, 1)).deadline;
    await escrow.connect(client).openDispute(id, 1, REASON);
    await time.increase(2 * DAY);
    await escrow.connect(client).withdrawDispute(id, 1);
    // a second dispute adds up
    await escrow.connect(client).openDispute(id, 1, REASON);
    await time.increase(DAY);
    await escrow.connect(client).withdrawDispute(id, 1);
    const paused = (await escrow.getMilestone(id, 1)).pausedFor;
    expect(paused).to.be.gte(BigInt(3 * DAY));
    const availableAt = deadline + paused + BigInt(HOUR);
    await time.setNextBlockTimestamp(availableAt);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 1)).to.be.revertedWithCustomError(
      escrow,
      "ReclaimNotYetAvailable",
    );
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 1)).to.changeTokenBalances(musd, [client], [E(60)]);
  });

  it("ChangesRequested: the post-change-request grace resumes where it paused", async () => {
    const { escrow, client, freelancer, id } = await funded({ deadlineReclaim: true, reclaimGracePeriod: 2 * DAY });
    const deadline = (await escrow.getMilestone(id, 0)).deadline;
    await time.increaseTo(deadline + 100n);
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await escrow.connect(client).requestChanges(id, 0, REASON);
    const changesAt = (await escrow.getMilestone(id, 0)).changesRequestedAt;
    await time.increase(DAY); // 1 of 2 grace days used
    const open = await escrow.connect(freelancer).openDispute(id, 0, REASON);
    await time.increase(10 * DAY);
    const w = await escrow.connect(freelancer).withdrawDispute(id, 0);
    const paused = (await blockTime(w)) - (await blockTime(open));
    const m = await escrow.getMilestone(id, 0);
    expect(m.changesRequestedAt).to.equal(changesAt + paused);
    const availableAt = changesAt + paused + BigInt(2 * DAY);
    expect(await escrow.reclaimAvailableAt(id, 0)).to.equal(availableAt);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0))
      .to.be.revertedWithCustomError(escrow, "ReclaimNotYetAvailable")
      .withArgs(availableAt);
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB(2));
    expect(await milestoneStatus(escrow, id, 0)).to.equal(MS.Submitted);
  });
});

describe("EscrowFlow v2 · B4. minimum reclaim grace", () => {
  it("deadline reclaim requires reclaimGracePeriod >= MIN_RECLAIM_GRACE (60 s) on create and update", async () => {
    const { escrow, client, freelancer } = await loadFixture(baseFixture);
    expect(await escrow.MIN_RECLAIM_GRACE()).to.equal(60n);
    for (const grace of [0, 1, 59]) {
      const bad = await makeParams({ freelancer: freelancer.address, deadlineReclaim: true, reclaimGracePeriod: grace });
      await expect(escrow.connect(client).createProject(bad)).to.be.revertedWithCustomError(escrow, "InvalidGracePeriod");
    }
    const ok = await makeParams({ freelancer: freelancer.address, deadlineReclaim: true, reclaimGracePeriod: 60 });
    await expect(escrow.connect(client).createProject(ok)).to.emit(escrow, "ProjectCreated");
    // without deadline reclaim the grace is irrelevant and may be 0
    const id = await createProject(escrow, client, { freelancer: freelancer.address, reclaimGracePeriod: 0 });
    const bad = await makeParams({ freelancer: freelancer.address, deadlineReclaim: true, reclaimGracePeriod: 0 });
    await expect(escrow.connect(client).updateTerms(id, bad)).to.be.revertedWithCustomError(escrow, "InvalidGracePeriod");
  });

  it("exploit: a zero grace let the client reclaim one second after the deadline, racing a late submission", async () => {
    const { escrow, client, freelancer, id } = await funded({ deadlineReclaim: true, reclaimGracePeriod: 60 });
    const deadline = (await escrow.getMilestone(id, 0)).deadline;
    await time.setNextBlockTimestamp(deadline + 1n);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0)).to.be.revertedWithCustomError(
      escrow,
      "ReclaimNotYetAvailable",
    );
    // the freelancer's slightly late submission lands inside the guaranteed minute
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await time.increase(DAY);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Submitted);
  });
});

describe("EscrowFlow v2 · B5. the freelancer cannot dispute work they never submitted", () => {
  it("exploit: freezing a never-submitted milestone (to block reclaim / cancellation) reverts NothingSubmitted", async () => {
    const { escrow, client, freelancer, id } = await funded({ deadlineReclaim: true });
    for (const i of [0, 1, 2, 3]) {
      await expect(escrow.connect(freelancer).openDispute(id, i, REASON)).to.be.revertedWithCustomError(
        escrow,
        "NothingSubmitted",
      );
    }
    // still nothing submitted after a client dispute is withdrawn (revision stays 0)
    await escrow.connect(client).openDispute(id, 0, REASON);
    await escrow.connect(client).withdrawDispute(id, 0);
    await expect(escrow.connect(freelancer).openDispute(id, 0, REASON)).to.be.revertedWithCustomError(
      escrow,
      "NothingSubmitted",
    );
    // the client may still dispute a Pending milestone; the freelancer may dispute submitted work
    await expect(escrow.connect(client).openDispute(id, 1, REASON)).to.emit(escrow, "DisputeOpened");
    await escrow.connect(freelancer).submitMilestone(id, 2, SUB());
    await expect(escrow.connect(freelancer).openDispute(id, 2, REASON)).to.emit(escrow, "DisputeOpened");
    await escrow.connect(freelancer).submitMilestone(id, 3, SUB(2));
    await escrow.connect(client).requestChanges(id, 3, REASON);
    await expect(escrow.connect(freelancer).openDispute(id, 3, REASON)).to.emit(escrow, "DisputeOpened");
  });
});

describe("EscrowFlow v2 · B6. closing clears proposals loudly; arbiter cannot be the token or the vault", () => {
  it("closing a project with a pending cancellation proposal emits CancellationRevoked", async () => {
    const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
    const id = await activeProject(escrow, musd, client, freelancer, { amounts: [E(10)] });
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await escrow.connect(freelancer).proposeCancellation(id);
    const tx = escrow.connect(client).approveAndRelease(id, 0);
    await expect(tx).to.emit(escrow, "ProjectClosed").withArgs(id, PS.Completed);
    await expect(tx).to.emit(escrow, "CancellationRevoked").withArgs(id, client.address);
    const p = await escrow.getProject(id);
    expect(p.status).to.equal(PS.Completed);
    expect(p.cancelProposer).to.equal(ethers.ZeroAddress);
    await expect(escrow.connect(client).acceptCancellation(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
      .withArgs(PS.Completed);
  });

  it("closing via arbiter ruling / reclaim also revokes; closing without a proposal emits no revocation", async () => {
    const { escrow, musd, client, freelancer, arbiter } = await loadFixture(baseFixture);
    const a = await activeProject(escrow, musd, client, freelancer, { amounts: [E(10)], arbiter: arbiter.address });
    await escrow.connect(client).openDispute(a, 0, REASON);
    await escrow.connect(client).proposeCancellation(a);
    await expect(escrow.connect(arbiter).arbiterResolve(a, 0, E(4)))
      .to.emit(escrow, "CancellationRevoked")
      .withArgs(a, arbiter.address);

    const b = await activeProject(escrow, musd, client, freelancer, { amounts: [E(10)], deadlineReclaim: true });
    await escrow.connect(freelancer).proposeCancellation(b);
    await time.increase(365 * DAY);
    await expect(escrow.connect(client).reclaimExpiredMilestone(b, 0))
      .to.emit(escrow, "CancellationRevoked")
      .withArgs(b, client.address);

    const c = await activeProject(escrow, musd, client, freelancer, { amounts: [E(10)] });
    await escrow.connect(freelancer).submitMilestone(c, 0, SUB());
    await expect(escrow.connect(client).approveAndRelease(c, 0)).to.not.emit(escrow, "CancellationRevoked");
    await assertInvariants(escrow, musd);
  });

  it("reverts InvalidParty when the arbiter is the token or the savings vault", async () => {
    const { escrow, musd, vault, client, freelancer } = await loadFixture(baseFixture);
    for (const bad of [await musd.getAddress(), await vault.getAddress()]) {
      const params = await makeParams({ freelancer: freelancer.address, arbiter: bad });
      await expect(escrow.connect(client).createProject(params)).to.be.revertedWithCustomError(escrow, "InvalidParty");
    }
    const id = await createProject(escrow, client, { freelancer: freelancer.address });
    const params = await makeParams({ freelancer: freelancer.address, arbiter: await vault.getAddress() });
    await expect(escrow.connect(client).updateTerms(id, params)).to.be.revertedWithCustomError(escrow, "InvalidParty");
  });

  it("a registry without a vault still accepts 'no arbiter' (address(0) is not mistaken for the vault)", async () => {
    const { escrow, token, client, freelancer } = await deployWithToken("MockMUSD");
    expect(await escrow.savingsVault()).to.equal(ethers.ZeroAddress);
    const id = await createProject(escrow, client, { freelancer: freelancer.address });
    expect((await escrow.getProject(id)).arbiter).to.equal(ethers.ZeroAddress);
    const bad = await makeParams({ freelancer: freelancer.address, arbiter: await token.getAddress() });
    await expect(escrow.connect(client).createProject(bad)).to.be.revertedWithCustomError(escrow, "InvalidParty");
  });
});
