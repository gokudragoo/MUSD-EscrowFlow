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
  RefundKind,
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

describe("EscrowFlow · mutual cancellation (funded project)", () => {
  it("propose → counterparty accepts immediately after funding: full refund, project Cancelled", async () => {
    const { escrow, musd, client, freelancer, id } = await funded();
    await expect(escrow.connect(client).proposeCancellation(id))
      .to.emit(escrow, "CancellationProposed")
      .withArgs(id, client.address);
    expect((await escrow.getProject(id)).cancelProposer).to.equal(client.address);
    const tx = escrow.connect(freelancer).acceptCancellation(id);
    await expect(tx).to.emit(escrow, "ProjectCancelled").withArgs(id, freelancer.address, E(200), true);
    await expect(tx).to.emit(escrow, "ProjectClosed").withArgs(id, PS.Cancelled);
    for (let i = 0; i < 4; i++) {
      await expect(tx)
        .to.emit(escrow, "MilestoneRefunded")
        .withArgs(id, BigInt(i), client.address, [E(40), E(60), E(60), E(40)][i], RefundKind.MutualCancellation);
    }
    await expect(tx).to.changeTokenBalances(musd, [client, freelancer, escrow], [E(200), 0n, -E(200)]);
    const p = await escrow.getProject(id);
    expect(p.status).to.equal(PS.Cancelled);
    expect(p.cancelled).to.equal(true);
    expect(p.cancelProposer).to.equal(ethers.ZeroAddress);
    expect(p.refundedAmount).to.equal(E(200));
    await assertInvariants(escrow, musd);
  });

  it("freelancer can propose and the client accept", async () => {
    const { escrow, musd, client, freelancer, id } = await funded();
    await escrow.connect(freelancer).proposeCancellation(id);
    await expect(escrow.connect(client).acceptCancellation(id)).to.changeTokenBalances(musd, [client], [E(200)]);
  });

  it("refunds only Pending / Submitted / ChangesRequested; released funds stay with the freelancer", async () => {
    const { escrow, musd, client, freelancer, id } = await funded();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB(1));
    await escrow.connect(client).approveAndRelease(id, 0); // M1 released (40)
    await escrow.connect(freelancer).submitMilestone(id, 1, SUB(2)); // M2 submitted (60)
    await escrow.connect(freelancer).submitMilestone(id, 2, SUB(3));
    await escrow.connect(client).requestChanges(id, 2, REASON); // M3 changes requested (60), M4 pending (40)

    await escrow.connect(freelancer).proposeCancellation(id);
    const tx = escrow.connect(client).acceptCancellation(id);
    await expect(tx).to.changeTokenBalances(musd, [client, freelancer, escrow], [E(160), 0n, -E(160)]);
    await expect(tx).to.emit(escrow, "ProjectCancelled").withArgs(id, client.address, E(160), true);
    await expect(tx).to.not.emit(escrow, "MilestoneReleased");
    const ms = await escrow.getMilestones(id);
    expect(ms.map((m) => m.status)).to.deep.equal([MS.Released, MS.Refunded, MS.Refunded, MS.Refunded]);
    const p = await escrow.getProject(id);
    expect(p.releasedAmount).to.equal(E(40));
    expect(p.refundedAmount).to.equal(E(160));
    expect(p.status).to.equal(PS.Cancelled);
    await assertInvariants(escrow, musd);
  });

  it("cannot accept your own proposal; cannot accept without a proposal", async () => {
    const { escrow, client, freelancer, id } = await funded();
    await expect(escrow.connect(client).acceptCancellation(id)).to.be.revertedWithCustomError(escrow, "NoCancellationProposal");
    await escrow.connect(client).proposeCancellation(id);
    await expect(escrow.connect(client).acceptCancellation(id)).to.be.revertedWithCustomError(escrow, "CannotAcceptOwnProposal");
    await escrow.connect(freelancer).proposeCancellation(id); // counter-propose overwrites proposer
    await expect(escrow.connect(freelancer).acceptCancellation(id)).to.be.revertedWithCustomError(
      escrow,
      "CannotAcceptOwnProposal",
    );
  });

  it("proposer can revoke; others cannot; revoking nothing reverts", async () => {
    const { escrow, client, freelancer, id } = await funded();
    await expect(escrow.connect(client).revokeCancellation(id)).to.be.revertedWithCustomError(escrow, "NoCancellationProposal");
    await escrow.connect(client).proposeCancellation(id);
    await expect(escrow.connect(freelancer).revokeCancellation(id)).to.be.revertedWithCustomError(escrow, "NotParty");
    await expect(escrow.connect(client).revokeCancellation(id))
      .to.emit(escrow, "CancellationRevoked")
      .withArgs(id, client.address);
    await expect(escrow.connect(freelancer).acceptCancellation(id)).to.be.revertedWithCustomError(
      escrow,
      "NoCancellationProposal",
    );
  });

  it("a new submission clears a pending cancellation proposal so it cannot sweep fresh work", async () => {
    const { escrow, client, freelancer, id } = await funded();
    await escrow.connect(client).proposeCancellation(id);
    await expect(escrow.connect(freelancer).submitMilestone(id, 0, SUB()))
      .to.emit(escrow, "CancellationRevoked")
      .withArgs(id, client.address);
    expect((await escrow.getProject(id)).cancelProposer).to.equal(ethers.ZeroAddress);
    await expect(escrow.connect(freelancer).acceptCancellation(id)).to.be.revertedWithCustomError(
      escrow,
      "NoCancellationProposal",
    );
  });

  it("cannot propose cancellation before funding", async () => {
    const { escrow, client, freelancer } = await loadFixture(baseFixture);
    const id = await createProject(escrow, client, { freelancer: freelancer.address });
    await acceptCurrent(escrow, freelancer, id);
    await expect(escrow.connect(client).proposeCancellation(id))
      .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
      .withArgs(PS.AwaitingFunding);
  });

  describe("with an open dispute", () => {
    async function cancelledWithDispute() {
      const ctx = await funded({ arbiter: (await ethers.getSigners())[4].address });
      const { escrow, client, freelancer, id } = ctx;
      await escrow.connect(freelancer).submitMilestone(id, 1, SUB(2));
      await escrow.connect(client).openDispute(id, 1, REASON); // M2 (60) disputed
      await escrow.connect(client).proposeCancellation(id);
      await escrow.connect(freelancer).acceptCancellation(id);
      return ctx;
    }

    it("disputed milestone is excluded from the refund and stays frozen; project stays Active+cancelled", async () => {
      const { escrow, musd, client, id } = await cancelledWithDispute();
      const p = await escrow.getProject(id);
      expect(p.cancelled).to.equal(true);
      expect(p.status).to.equal(PS.Active);
      expect(p.refundedAmount).to.equal(E(140));
      expect(await escrow.heldAmount(id)).to.equal(E(60));
      expect(await milestoneStatus(escrow, id, 1)).to.equal(MS.Disputed);
      expect(await musd.balanceOf(await escrow.getAddress())).to.equal(E(60));
      // nothing else can move it
      await expect(escrow.connect(client).approveAndRelease(id, 1))
        .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
        .withArgs(MS.Disputed);
      await assertInvariants(escrow, musd);
    });

    it("the frozen milestone is later resolvable and the project closes as Cancelled", async () => {
      const { escrow, musd, client, freelancer, id } = await cancelledWithDispute();
      await escrow.connect(freelancer).proposeSettlement(id, 1, E(25));
      const tx = escrow.connect(client).acceptSettlement(id, 1, E(25));
      await expect(tx).to.emit(escrow, "ProjectClosed").withArgs(id, PS.Cancelled);
      await expect(tx).to.changeTokenBalances(musd, [freelancer, client], [E(25), E(35)]);
      expect((await escrow.getProject(id)).status).to.equal(PS.Cancelled);
      await assertInvariants(escrow, musd);
    });

    it("the arbiter can rule on it after cancellation", async () => {
      const { escrow, musd, arbiter, freelancer, id } = await cancelledWithDispute();
      await expect(escrow.connect(arbiter).arbiterResolve(id, 1, E(60))).to.changeTokenBalances(musd, [freelancer], [E(60)]);
      expect((await escrow.getProject(id)).status).to.equal(PS.Cancelled);
    });

    it("dispute cannot be withdrawn after cancellation; no new submissions or cancellations", async () => {
      const { escrow, client, freelancer, id } = await cancelledWithDispute();
      await expect(escrow.connect(client).withdrawDispute(id, 1)).to.be.revertedWithCustomError(
        escrow,
        "DisputeLockedByCancellation",
      );
      await expect(escrow.connect(freelancer).submitMilestone(id, 1, SUB(5))).to.be.revertedWithCustomError(
        escrow,
        "ProjectAlreadyCancelled",
      );
      await expect(escrow.connect(client).proposeCancellation(id)).to.be.revertedWithCustomError(
        escrow,
        "ProjectAlreadyCancelled",
      );
    });
  });
});

describe("EscrowFlow · deadline reclaim (refund rules)", () => {
  async function reclaimable(grace = DAY) {
    const ctx = await funded({ deadlineReclaim: true, reclaimGracePeriod: grace });
    const m0 = await ctx.escrow.getMilestone(ctx.id, 0);
    return { ...ctx, deadline0: m0.deadline, grace: BigInt(grace) };
  }

  it("reverts ReclaimDisabled when deadline reclaim was not agreed", async () => {
    const { escrow, client, id } = await funded();
    await time.increase(365 * DAY);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0)).to.be.revertedWithCustomError(escrow, "ReclaimDisabled");
    expect(await escrow.reclaimAvailableAt(id, 0)).to.equal(0n);
  });

  it("reverts ReclaimNotYetAvailable until strictly after deadline + grace, then refunds the client", async () => {
    const { escrow, musd, client, freelancer, id, deadline0, grace } = await reclaimable();
    const availableAt = deadline0 + grace;
    expect(await escrow.reclaimAvailableAt(id, 0)).to.equal(availableAt);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0))
      .to.be.revertedWithCustomError(escrow, "ReclaimNotYetAvailable")
      .withArgs(availableAt);
    await time.setNextBlockTimestamp(availableAt);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0)).to.be.revertedWithCustomError(
      escrow,
      "ReclaimNotYetAvailable",
    );
    const tx = escrow.connect(client).reclaimExpiredMilestone(id, 0);
    await expect(tx)
      .to.emit(escrow, "MilestoneRefunded")
      .withArgs(id, 0n, client.address, E(40), RefundKind.DeadlineReclaim);
    await expect(tx).to.changeTokenBalances(musd, [client, freelancer, escrow], [E(40), 0n, -E(40)]);
    const m = await escrow.getMilestone(id, 0);
    expect(m.status).to.equal(MS.Refunded);
    expect(m.refundedAmount).to.equal(E(40));
    expect((await escrow.getProject(id)).refundedAmount).to.equal(E(40));
    await assertInvariants(escrow, musd);
  });

  it("cannot reclaim a Submitted milestone, even long past the deadline", async () => {
    const { escrow, client, freelancer, id } = await reclaimable();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await time.increase(365 * DAY);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Submitted);
    expect(await escrow.reclaimAvailableAt(id, 0)).to.equal(0n);
  });

  it("a late submission (after deadline, before reclaim) wins the race and blocks reclaim", async () => {
    const { escrow, client, freelancer, id, deadline0 } = await reclaimable();
    await time.increaseTo(deadline0 + 10n);
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await time.increase(10 * DAY);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Submitted);
  });

  it("cannot reclaim a Disputed or Released milestone", async () => {
    const { escrow, client, freelancer, id } = await reclaimable();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await escrow.connect(client).approveAndRelease(id, 0);
    await escrow.connect(freelancer).openDispute(id, 1, REASON);
    await time.increase(365 * DAY);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Released);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 1))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Disputed);
  });

  it("cannot reclaim twice", async () => {
    const { escrow, client, id, deadline0, grace } = await reclaimable();
    await time.increaseTo(deadline0 + grace + 1n);
    await escrow.connect(client).reclaimExpiredMilestone(id, 0);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Refunded);
  });

  it("ChangesRequested early: reclaim available at deadline + grace", async () => {
    const { escrow, client, freelancer, id, deadline0, grace } = await reclaimable();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await escrow.connect(client).requestChanges(id, 0, REASON);
    expect(await escrow.reclaimAvailableAt(id, 0)).to.equal(deadline0 + grace);
    await time.increaseTo(deadline0 + grace + 1n);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0)).to.emit(escrow, "MilestoneRefunded");
  });

  it("ChangesRequested after the deadline: freelancer keeps `grace` after the change request to resubmit", async () => {
    const { escrow, client, freelancer, id, deadline0, grace } = await reclaimable();
    await time.increaseTo(deadline0 + 100n);
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await time.increaseTo(deadline0 + grace - 10n);
    await escrow.connect(client).requestChanges(id, 0, REASON);
    const changesAt = (await escrow.getMilestone(id, 0)).changesRequestedAt;
    const availableAt = changesAt + grace;
    expect(await escrow.reclaimAvailableAt(id, 0)).to.equal(availableAt);
    await time.increaseTo(deadline0 + grace + 5n); // past deadline+grace but not changes+grace
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0))
      .to.be.revertedWithCustomError(escrow, "ReclaimNotYetAvailable")
      .withArgs(availableAt);
    await time.increaseTo(availableAt + 1n);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0)).to.emit(escrow, "MilestoneRefunded");
  });

  it("grace 0 allows reclaim one second after the deadline", async () => {
    const { escrow, client, id, deadline0 } = await reclaimable(0);
    await time.increaseTo(deadline0 + 1n);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0)).to.emit(escrow, "MilestoneRefunded");
  });

  it("reclaiming every milestone closes the project as Completed (no cancellation executed)", async () => {
    const { escrow, musd, client, id } = await reclaimable();
    await time.increase(365 * DAY);
    for (let i = 0; i < 4; i++) {
      const tx = escrow.connect(client).reclaimExpiredMilestone(id, i);
      if (i === 3) await expect(tx).to.emit(escrow, "ProjectClosed").withArgs(id, PS.Completed);
      else await tx;
    }
    const p = await escrow.getProject(id);
    expect(p.refundedAmount).to.equal(E(200));
    expect(p.status).to.equal(PS.Completed);
    await assertInvariants(escrow, musd);
  });
});

describe("EscrowFlow · fund-safety guarantees", () => {
  it("the client can never claw back released funds", async () => {
    const { escrow, musd, client, freelancer, id } = await funded({ deadlineReclaim: true, autoRelease: true });
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await escrow.connect(client).approveAndRelease(id, 0);
    const freelancerBal = await musd.balanceOf(freelancer.address);
    await time.increase(365 * DAY);

    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 0)).to.be.revertedWithCustomError(
      escrow,
      "InvalidMilestoneStatus",
    );
    await expect(escrow.connect(client).openDispute(id, 0, REASON)).to.be.revertedWithCustomError(
      escrow,
      "InvalidMilestoneStatus",
    );
    await expect(escrow.connect(client).cancelUnfunded(id)).to.be.revertedWithCustomError(escrow, "InvalidProjectStatus");
    await expect(
      escrow.connect(client).updateTerms(id, {
        freelancer: client.address,
        arbiter: ethers.ZeroAddress,
        termsHash: REASON,
        autoRelease: false,
        deadlineReclaim: false,
        reclaimGracePeriod: 0,
        amounts: [1n],
        deadlines: [BigInt(await time.latest()) + 1000n],
        reviewPeriods: [60],
      }),
    ).to.be.revertedWithCustomError(escrow, "InvalidProjectStatus");
    // Mutual cancellation (even if the freelancer agreed) refunds only the unreleased milestones.
    await escrow.connect(client).proposeCancellation(id);
    await expect(escrow.connect(freelancer).acceptCancellation(id)).to.changeTokenBalances(musd, [client], [E(160)]);
    expect(await musd.balanceOf(freelancer.address)).to.equal(freelancerBal);
    expect((await escrow.getProject(id)).releasedAmount).to.equal(E(40));
    await assertInvariants(escrow, musd);
  });

  it("the freelancer can never withdraw unapproved funds (every payout path on a Pending milestone)", async () => {
    const { escrow, musd, freelancer, arbiter, id } = await funded({
      autoRelease: true,
      deadlineReclaim: true,
      arbiter: (await ethers.getSigners())[4].address,
    });
    void arbiter;
    const before = await musd.balanceOf(freelancer.address);
    await time.increase(365 * DAY);
    const f = escrow.connect(freelancer);
    await expect(f.claimAfterReviewTimeout(id, 0)).to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus").withArgs(MS.Pending);
    await expect(f.approveAndRelease(id, 0)).to.be.revertedWithCustomError(escrow, "NotClient");
    await expect(f.reclaimExpiredMilestone(id, 0)).to.be.revertedWithCustomError(escrow, "NotClient");
    await expect(f.acceptSettlement(id, 0, E(40))).to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus");
    await expect(f.arbiterResolve(id, 0, E(40))).to.be.revertedWithCustomError(escrow, "NotArbiter");
    await expect(f.acceptCancellation(id)).to.be.revertedWithCustomError(escrow, "NoCancellationProposal");
    await expect(f.fund(id)).to.be.revertedWithCustomError(escrow, "NotClient");
    // self-dispute + self-settlement is impossible
    await f.openDispute(id, 0, REASON);
    await f.proposeSettlement(id, 0, E(40));
    await expect(f.acceptSettlement(id, 0, E(40))).to.be.revertedWithCustomError(escrow, "CannotAcceptOwnProposal");
    // self-proposed cancellation cannot be self-accepted (and would refund the client anyway)
    await f.proposeCancellation(id);
    await expect(f.acceptCancellation(id)).to.be.revertedWithCustomError(escrow, "CannotAcceptOwnProposal");
    expect(await musd.balanceOf(freelancer.address)).to.equal(before);
    expect(await escrow.heldAmount(id)).to.equal(E(200));
    await assertInvariants(escrow, musd);
  });
});
