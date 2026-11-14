import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  baseFixture,
  activeProject,
  createProject,
  acceptCurrent,
  assertInvariants,
  milestoneStatus,
  PS,
  MS,
  ReleaseKind,
  E,
  DAY,
  SUB,
  REASON,
  ParamOpts,
} from "./helpers";

async function funded(opts: Partial<ParamOpts> = {}) {
  const ctx = await loadFixture(baseFixture);
  const id = await activeProject(ctx.escrow, ctx.musd, ctx.client, ctx.freelancer, opts);
  return { ...ctx, id };
}

async function fundedWithArbiterAndAuto() {
  const ctx = await loadFixture(baseFixture);
  const id = await activeProject(ctx.escrow, ctx.musd, ctx.client, ctx.freelancer, {
    arbiter: ctx.arbiter.address,
    autoRelease: true,
    deadlineReclaim: true,
  });
  return { ...ctx, id };
}

describe("EscrowFlow · work submission", () => {
  it("freelancer submits: Submitted, revision 1, timestamp and review deadline recorded", async () => {
    const { escrow, freelancer, id } = await funded();
    const tx = await escrow.connect(freelancer).submitMilestone(id, 0, SUB(1));
    const ts = BigInt((await ethers.provider.getBlock(tx.blockNumber!))!.timestamp);
    await expect(tx)
      .to.emit(escrow, "MilestoneSubmitted")
      .withArgs(id, 0n, SUB(1), 1, ts + BigInt(3 * DAY));
    const m = await escrow.getMilestone(id, 0);
    expect(m.status).to.equal(MS.Submitted);
    expect(m.revision).to.equal(1n);
    expect(m.submittedAt).to.equal(ts);
    expect(m.submissionHash).to.equal(SUB(1));
    expect(await escrow.reviewDeadline(id, 0)).to.equal(ts + BigInt(3 * DAY));
  });

  it("rejects submission by non-freelancer, before funding, with empty hash, bad index, or while already submitted", async () => {
    const { escrow, musd, client, freelancer, stranger, id } = await funded();
    await expect(escrow.connect(client).submitMilestone(id, 0, SUB())).to.be.revertedWithCustomError(escrow, "NotFreelancer");
    await expect(escrow.connect(stranger).submitMilestone(id, 0, SUB())).to.be.revertedWithCustomError(escrow, "NotFreelancer");
    await expect(escrow.connect(freelancer).submitMilestone(id, 0, ethers.ZeroHash)).to.be.revertedWithCustomError(
      escrow,
      "EmptySubmission",
    );
    await expect(escrow.connect(freelancer).submitMilestone(id, 4, SUB()))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneIndex")
      .withArgs(4n);
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await expect(escrow.connect(freelancer).submitMilestone(id, 0, SUB(2)))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Submitted);

    const unfunded = await createProject(escrow, client, { freelancer: freelancer.address });
    await acceptCurrent(escrow, freelancer, unfunded);
    await expect(escrow.connect(freelancer).submitMilestone(unfunded, 0, SUB()))
      .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
      .withArgs(PS.AwaitingFunding);
    await assertInvariants(escrow, musd);
  });

  it("milestones may be delivered in any order", async () => {
    const { escrow, freelancer, id } = await funded();
    await escrow.connect(freelancer).submitMilestone(id, 3, SUB(4));
    await escrow.connect(freelancer).submitMilestone(id, 1, SUB(2));
    expect(await milestoneStatus(escrow, id, 3)).to.equal(MS.Submitted);
    expect(await milestoneStatus(escrow, id, 1)).to.equal(MS.Submitted);
    expect(await milestoneStatus(escrow, id, 0)).to.equal(MS.Pending);
  });
});

describe("EscrowFlow · valid milestone release", () => {
  it("approveAndRelease transfers exactly the milestone amount to the freelancer and updates accounting", async () => {
    const { escrow, musd, client, freelancer, id } = await funded();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    const tx = escrow.connect(client).approveAndRelease(id, 0);
    await expect(tx)
      .to.emit(escrow, "MilestoneReleased")
      .withArgs(id, 0n, freelancer.address, E(40), ReleaseKind.ClientApproval);
    await expect(tx)
      .to.emit(musd, "Transfer")
      .withArgs(await escrow.getAddress(), freelancer.address, E(40));
    await expect(tx).to.changeTokenBalances(musd, [escrow, freelancer, client], [-E(40), E(40), 0n]);

    const p = await escrow.getProject(id);
    expect(p.releasedAmount).to.equal(E(40));
    expect(p.refundedAmount).to.equal(0n);
    expect(await escrow.heldAmount(id)).to.equal(E(160));
    expect(await escrow.totalHeld()).to.equal(E(160));
    const m = await escrow.getMilestone(id, 0);
    expect(m.status).to.equal(MS.Released);
    expect(m.releasedAmount).to.equal(E(40));
    expect(p.status).to.equal(PS.Active);
    await assertInvariants(escrow, musd);
  });

  it("client may approve a milestone in ChangesRequested (accepting the earlier submission)", async () => {
    const { escrow, musd, client, freelancer, id } = await funded();
    await escrow.connect(freelancer).submitMilestone(id, 1, SUB());
    await escrow.connect(client).requestChanges(id, 1, REASON);
    await expect(escrow.connect(client).approveAndRelease(id, 1)).to.changeTokenBalances(musd, [freelancer], [E(60)]);
  });

  it("a Pending (never submitted) milestone cannot be released", async () => {
    const { escrow, client, id } = await funded();
    await expect(escrow.connect(client).approveAndRelease(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Pending);
  });

  it("releasing every milestone completes the project and empties the escrow", async () => {
    const { escrow, musd, client, freelancer, id } = await funded();
    for (let i = 0; i < 4; i++) {
      await escrow.connect(freelancer).submitMilestone(id, i, SUB(i));
      const tx = escrow.connect(client).approveAndRelease(id, i);
      if (i === 3) await expect(tx).to.emit(escrow, "ProjectClosed").withArgs(id, PS.Completed);
      else await expect(tx).to.not.emit(escrow, "ProjectClosed");
      await assertInvariants(escrow, musd);
    }
    const p = await escrow.getProject(id);
    expect(p.status).to.equal(PS.Completed);
    expect(p.releasedAmount).to.equal(E(200));
    expect(await escrow.heldAmount(id)).to.equal(0n);
    expect(await musd.balanceOf(await escrow.getAddress())).to.equal(0n);
  });
});

describe("EscrowFlow · duplicate release prevention", () => {
  async function released() {
    const ctx = await fundedWithArbiterAndAuto();
    await ctx.escrow.connect(ctx.freelancer).submitMilestone(ctx.id, 0, SUB());
    await ctx.escrow.connect(ctx.client).approveAndRelease(ctx.id, 0);
    return ctx;
  }

  it("a second approveAndRelease reverts InvalidMilestoneStatus(Released)", async () => {
    const { escrow, client, id } = await released();
    await expect(escrow.connect(client).approveAndRelease(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Released);
  });

  it("a review-timeout claim after approval reverts", async () => {
    const { escrow, freelancer, id } = await released();
    await time.increase(4 * DAY);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Released);
  });

  it("released milestones cannot be resubmitted, disputed, reclaimed or settled", async () => {
    const { escrow, client, freelancer, arbiter, id } = await released();
    await expect(escrow.connect(freelancer).submitMilestone(id, 0, SUB(9)))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Released);
    await expect(escrow.connect(client).openDispute(id, 0, REASON))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Released);
    await time.increase(60 * DAY);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Released);
    await expect(escrow.connect(arbiter).arbiterResolve(id, 0, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Released);
    await expect(escrow.connect(client).proposeSettlement(id, 0, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Released);
  });

  it("after completion no milestone function can pay again", async () => {
    const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
    const id = await activeProject(escrow, musd, client, freelancer, { amounts: [E(5)] });
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await escrow.connect(client).approveAndRelease(id, 0);
    expect((await escrow.getProject(id)).status).to.equal(PS.Completed);
    await expect(escrow.connect(client).approveAndRelease(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
      .withArgs(PS.Completed);
    await expect(escrow.connect(client).proposeCancellation(id))
      .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
      .withArgs(PS.Completed);
  });
});

describe("EscrowFlow · unauthorized release attempts", () => {
  it("only the client can approveAndRelease (stranger, freelancer, arbiter → NotClient)", async () => {
    const { escrow, freelancer, stranger, arbiter, id } = await fundedWithArbiterAndAuto();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    for (const s of [stranger, freelancer, arbiter]) {
      await expect(escrow.connect(s).approveAndRelease(id, 0)).to.be.revertedWithCustomError(escrow, "NotClient");
    }
    expect(await milestoneStatus(escrow, id, 0)).to.equal(MS.Submitted);
  });

  it("only the freelancer can claim after review timeout", async () => {
    const { escrow, client, freelancer, stranger, arbiter, id } = await fundedWithArbiterAndAuto();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await time.increase(4 * DAY);
    for (const s of [client, stranger, arbiter]) {
      await expect(escrow.connect(s).claimAfterReviewTimeout(id, 0)).to.be.revertedWithCustomError(escrow, "NotFreelancer");
    }
  });

  it("only the client can request changes or reclaim", async () => {
    const { escrow, freelancer, stranger, id } = await fundedWithArbiterAndAuto();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    for (const s of [freelancer, stranger]) {
      await expect(escrow.connect(s).requestChanges(id, 0, REASON)).to.be.revertedWithCustomError(escrow, "NotClient");
    }
    await time.increase(90 * DAY);
    for (const s of [freelancer, stranger]) {
      await expect(escrow.connect(s).reclaimExpiredMilestone(id, 1)).to.be.revertedWithCustomError(escrow, "NotClient");
    }
  });

  it("outsiders cannot open disputes, settle, or touch cancellation (NotParty)", async () => {
    const { escrow, client, freelancer, stranger, arbiter, id } = await fundedWithArbiterAndAuto();
    for (const s of [stranger, arbiter]) {
      await expect(escrow.connect(s).openDispute(id, 0, REASON)).to.be.revertedWithCustomError(escrow, "NotParty");
      await expect(escrow.connect(s).proposeCancellation(id)).to.be.revertedWithCustomError(escrow, "NotParty");
    }
    await escrow.connect(client).openDispute(id, 0, REASON);
    await escrow.connect(freelancer).proposeSettlement(id, 0, E(10));
    for (const s of [stranger, arbiter]) {
      await expect(escrow.connect(s).proposeSettlement(id, 0, 0)).to.be.revertedWithCustomError(escrow, "NotParty");
      await expect(escrow.connect(s).acceptSettlement(id, 0, E(10))).to.be.revertedWithCustomError(escrow, "NotParty");
    }
    await escrow.connect(client).proposeCancellation(id);
    for (const s of [stranger, arbiter]) {
      await expect(escrow.connect(s).acceptCancellation(id, E(200))).to.be.revertedWithCustomError(escrow, "NotParty");
      await expect(escrow.connect(s).revokeCancellation(id)).to.be.revertedWithCustomError(escrow, "NotParty");
    }
    await expect(escrow.connect(stranger).withdrawDispute(id, 0)).to.be.revertedWithCustomError(escrow, "NotDisputeInitiator");
  });

  it("only the agreed arbiter can rule; with no arbiter nobody can", async () => {
    const { escrow, musd, client, freelancer, stranger, arbiter, id } = await fundedWithArbiterAndAuto();
    await escrow.connect(client).openDispute(id, 0, REASON);
    for (const s of [stranger, client, freelancer]) {
      await expect(escrow.connect(s).arbiterResolve(id, 0, 0)).to.be.revertedWithCustomError(escrow, "NotArbiter");
    }
    const noArb = await activeProject(escrow, musd, client, freelancer);
    await escrow.connect(client).openDispute(noArb, 0, REASON);
    for (const s of [stranger, client, freelancer, arbiter]) {
      await expect(escrow.connect(s).arbiterResolve(noArb, 0, 0)).to.be.revertedWithCustomError(escrow, "NotArbiter");
    }
  });
});

describe("EscrowFlow · review window & unresponsive client (auto-release)", () => {
  async function submitted(autoRelease = true) {
    const ctx = await funded({ autoRelease });
    const tx = await ctx.escrow.connect(ctx.freelancer).submitMilestone(ctx.id, 0, SUB());
    const submittedAt = BigInt((await ethers.provider.getBlock(tx.blockNumber!))!.timestamp);
    return { ...ctx, dueAt: submittedAt + BigInt(3 * DAY) };
  }

  it("claim before the review period elapses reverts ReviewWindowOpen(dueAt)", async () => {
    const { escrow, freelancer, id, dueAt } = await submitted();
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0))
      .to.be.revertedWithCustomError(escrow, "ReviewWindowOpen")
      .withArgs(dueAt);
    await time.setNextBlockTimestamp(dueAt - 1n);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0)).to.be.revertedWithCustomError(
      escrow,
      "ReviewWindowOpen",
    );
  });

  it("claim exactly at the review deadline pays the freelancer (kind = ReviewTimeout)", async () => {
    const { escrow, musd, freelancer, id, dueAt } = await submitted();
    await time.setNextBlockTimestamp(dueAt);
    const tx = escrow.connect(freelancer).claimAfterReviewTimeout(id, 0);
    await expect(tx)
      .to.emit(escrow, "MilestoneReleased")
      .withArgs(id, 0n, freelancer.address, E(40), ReleaseKind.ReviewTimeout);
    await expect(tx).to.changeTokenBalances(musd, [freelancer, escrow], [E(40), -E(40)]);
    await assertInvariants(escrow, musd);
  });

  it("claim is impossible when auto-release was not agreed (AutoReleaseDisabled)", async () => {
    const { escrow, freelancer, id } = await submitted(false);
    await time.increase(30 * DAY);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0)).to.be.revertedWithCustomError(
      escrow,
      "AutoReleaseDisabled",
    );
  });

  it("claim on a Pending milestone reverts", async () => {
    const { escrow, freelancer, id } = await submitted();
    await time.increase(30 * DAY);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 1))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Pending);
  });

  it("requestChanges inside the window works; after the window it reverts ReviewWindowElapsed (auto-release on)", async () => {
    const { escrow, client, freelancer, id, dueAt } = await submitted();
    await time.setNextBlockTimestamp(dueAt - 1n);
    await expect(escrow.connect(client).requestChanges(id, 0, REASON))
      .to.emit(escrow, "ChangesRequested")
      .withArgs(id, 0n, REASON, 1);
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB(2));
    await time.increase(3 * DAY);
    await expect(escrow.connect(client).requestChanges(id, 0, REASON)).to.be.revertedWithCustomError(
      escrow,
      "ReviewWindowElapsed",
    );
  });

  it("requestChanges after the window is allowed when auto-release is off (window is advisory)", async () => {
    const { escrow, client, id } = await submitted(false);
    await time.increase(10 * DAY);
    await expect(escrow.connect(client).requestChanges(id, 0, REASON)).to.emit(escrow, "ChangesRequested");
    expect(await milestoneStatus(escrow, id, 0)).to.equal(MS.ChangesRequested);
  });

  it("client cannot block a vested claim with a dispute, but the freelancer may still dispute", async () => {
    const { escrow, client, freelancer, id, dueAt } = await submitted();
    await time.setNextBlockTimestamp(dueAt);
    await expect(escrow.connect(client).openDispute(id, 0, REASON)).to.be.revertedWithCustomError(escrow, "ReviewWindowElapsed");
    await expect(escrow.connect(freelancer).openDispute(id, 0, REASON)).to.emit(escrow, "DisputeOpened");
  });

  it("client can still approve after the window elapsed", async () => {
    const { escrow, musd, client, freelancer, id } = await submitted();
    await time.increase(5 * DAY);
    await expect(escrow.connect(client).approveAndRelease(id, 0)).to.changeTokenBalances(musd, [freelancer], [E(40)]);
  });

  it("a change request stops the clock: claim impossible until resubmission, then a fresh window applies", async () => {
    const { escrow, client, freelancer, id } = await submitted();
    await time.increase(DAY);
    await escrow.connect(client).requestChanges(id, 0, REASON);
    const cr = await escrow.getMilestone(id, 0);
    expect(cr.changesRequestedAt).to.equal(BigInt(await time.latest()));
    expect(await escrow.reviewDeadline(id, 0)).to.equal(0n);
    await time.increase(10 * DAY);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.ChangesRequested);
    const tx = await escrow.connect(freelancer).submitMilestone(id, 0, SUB(2));
    const resubAt = BigInt((await ethers.provider.getBlock(tx.blockNumber!))!.timestamp);
    expect((await escrow.getMilestone(id, 0)).revision).to.equal(2n);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0))
      .to.be.revertedWithCustomError(escrow, "ReviewWindowOpen")
      .withArgs(resubAt + BigInt(3 * DAY));
    await time.increase(3 * DAY);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0)).to.emit(escrow, "MilestoneReleased");
  });

  it("a client dispute inside the window freezes the claim", async () => {
    const { escrow, client, freelancer, id } = await submitted();
    await escrow.connect(client).openDispute(id, 0, REASON);
    await time.increase(10 * DAY);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Disputed);
  });

  it("works with the 60-second minimum review period", async () => {
    const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
    const id = await activeProject(escrow, musd, client, freelancer, {
      amounts: [E(1)],
      reviewPeriods: [60],
      autoRelease: true,
    });
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await time.increase(60);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0)).to.changeTokenBalances(musd, [freelancer], [E(1)]);
    expect((await escrow.getProject(id)).status).to.equal(PS.Completed);
  });
});
