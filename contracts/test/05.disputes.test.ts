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
  ResolutionKind,
  E,
  DAY,
  SUB,
  REASON,
} from "./helpers";

async function disputable() {
  const ctx = await loadFixture(baseFixture);
  const id = await activeProject(ctx.escrow, ctx.musd, ctx.client, ctx.freelancer, {
    arbiter: ctx.arbiter.address,
    autoRelease: true,
    deadlineReclaim: true,
  });
  await ctx.escrow.connect(ctx.freelancer).submitMilestone(id, 1, SUB(2)); // M2 = 60 MUSD submitted
  return { ...ctx, id };
}

describe("EscrowFlow · dispute opening", () => {
  it("client opens a dispute on a submitted milestone: Disputed, initiator, timestamps, counter", async () => {
    const { escrow, musd, client, id } = await disputable();
    await expect(escrow.connect(client).openDispute(id, 1, REASON))
      .to.emit(escrow, "DisputeOpened")
      .withArgs(id, 1n, client.address, REASON);
    const m = await escrow.getMilestone(id, 1);
    expect(m.status).to.equal(MS.Disputed);
    expect(m.statusBeforeDispute).to.equal(MS.Submitted);
    expect(m.disputeInitiator).to.equal(client.address);
    expect(m.disputedAt).to.equal(BigInt(await time.latest()));
    expect((await escrow.getProject(id)).openDisputes).to.equal(1n);
    await assertInvariants(escrow, musd);
  });

  it("freelancer can dispute Pending and ChangesRequested milestones; counter tracks multiple disputes", async () => {
    const { escrow, musd, client, freelancer, id } = await disputable();
    await escrow.connect(client).requestChanges(id, 1, REASON);
    await escrow.connect(freelancer).openDispute(id, 1, REASON);
    await escrow.connect(freelancer).openDispute(id, 0, REASON);
    expect((await escrow.getMilestone(id, 1)).statusBeforeDispute).to.equal(MS.ChangesRequested);
    expect((await escrow.getMilestone(id, 0)).statusBeforeDispute).to.equal(MS.Pending);
    expect((await escrow.getProject(id)).openDisputes).to.equal(2n);
    await assertInvariants(escrow, musd);
  });

  it("cannot dispute an already-disputed or settled milestone, or an unfunded project", async () => {
    const { escrow, client, freelancer, id } = await disputable();
    await escrow.connect(client).openDispute(id, 1, REASON);
    await expect(escrow.connect(freelancer).openDispute(id, 1, REASON))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Disputed);
    const unfunded = await createProject(escrow, client, { freelancer: freelancer.address });
    await acceptCurrent(escrow, freelancer, unfunded);
    await expect(escrow.connect(client).openDispute(unfunded, 0, REASON))
      .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
      .withArgs(PS.AwaitingFunding);
    await expect(escrow.connect(client).openDispute(id, 9, REASON))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneIndex")
      .withArgs(9n);
  });
});

describe("EscrowFlow · dispute restrictions (funds frozen)", () => {
  it("approve, claim, reclaim, resubmit and change requests are all blocked while disputed", async () => {
    const { escrow, musd, client, freelancer, id } = await disputable();
    await escrow.connect(client).openDispute(id, 1, REASON);
    await time.increase(365 * DAY);
    const bal = await musd.balanceOf(await escrow.getAddress());
    await expect(escrow.connect(client).approveAndRelease(id, 1))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Disputed);
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 1))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Disputed);
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 1))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Disputed);
    await expect(escrow.connect(freelancer).submitMilestone(id, 1, SUB(3)))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Disputed);
    await expect(escrow.connect(client).requestChanges(id, 1, REASON))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Disputed);
    expect(await musd.balanceOf(await escrow.getAddress())).to.equal(bal);
    expect(await milestoneStatus(escrow, id, 1)).to.equal(MS.Disputed);
  });

  it("mutual cancellation does not refund the disputed milestone", async () => {
    const { escrow, musd, client, freelancer, id } = await disputable();
    await escrow.connect(freelancer).openDispute(id, 1, REASON);
    await escrow.connect(freelancer).proposeCancellation(id);
    await expect(escrow.connect(client).acceptCancellation(id)).to.changeTokenBalances(musd, [client], [E(140)]);
    expect(await milestoneStatus(escrow, id, 1)).to.equal(MS.Disputed);
    expect(await escrow.heldAmount(id)).to.equal(E(60));
  });
});

describe("EscrowFlow · mutual settlement", () => {
  async function disputed() {
    const ctx = await disputable();
    await ctx.escrow.connect(ctx.client).openDispute(ctx.id, 1, REASON);
    return ctx;
  }

  it("proposal above the milestone amount reverts SettlementExceedsAmount", async () => {
    const { escrow, client, id } = await disputed();
    await expect(escrow.connect(client).proposeSettlement(id, 1, E(60) + 1n)).to.be.revertedWithCustomError(
      escrow,
      "SettlementExceedsAmount",
    );
  });

  it("proposing on a non-disputed milestone reverts", async () => {
    const { escrow, client, id } = await disputed();
    await expect(escrow.connect(client).proposeSettlement(id, 0, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Pending);
  });

  it("accepting with no standing proposal reverts NoSettlementProposal", async () => {
    const { escrow, freelancer, id } = await disputed();
    await expect(escrow.connect(freelancer).acceptSettlement(id, 1, 0)).to.be.revertedWithCustomError(
      escrow,
      "NoSettlementProposal",
    );
  });

  it("cannot accept your own proposal", async () => {
    const { escrow, client, id } = await disputed();
    await escrow.connect(client).proposeSettlement(id, 1, E(20));
    await expect(escrow.connect(client).acceptSettlement(id, 1, E(20))).to.be.revertedWithCustomError(
      escrow,
      "CannotAcceptOwnProposal",
    );
  });

  it("accepting a different amount than proposed reverts SettlementMismatch(proposed)", async () => {
    const { escrow, client, freelancer, id } = await disputed();
    await expect(escrow.connect(client).proposeSettlement(id, 1, E(20)))
      .to.emit(escrow, "SettlementProposed")
      .withArgs(id, 1n, client.address, E(20));
    await expect(escrow.connect(freelancer).acceptSettlement(id, 1, E(30)))
      .to.be.revertedWithCustomError(escrow, "SettlementMismatch")
      .withArgs(E(20));
  });

  it("a counter-proposal replaces the standing one", async () => {
    const { escrow, musd, client, freelancer, id } = await disputed();
    await escrow.connect(client).proposeSettlement(id, 1, E(10));
    await escrow.connect(freelancer).proposeSettlement(id, 1, E(45));
    const m = await escrow.getMilestone(id, 1);
    expect(m.settlementProposer).to.equal(freelancer.address);
    expect(m.proposedFreelancerAmount).to.equal(E(45));
    await expect(escrow.connect(client).acceptSettlement(id, 1, E(10)))
      .to.be.revertedWithCustomError(escrow, "SettlementMismatch")
      .withArgs(E(45));
    await expect(escrow.connect(freelancer).acceptSettlement(id, 1, E(45))).to.be.revertedWithCustomError(
      escrow,
      "CannotAcceptOwnProposal",
    );
    await expect(escrow.connect(client).acceptSettlement(id, 1, E(45))).to.changeTokenBalances(
      musd,
      [freelancer, client, escrow],
      [E(45), E(15), -E(60)],
    );
  });

  it("a split pays both sides exactly and records the resolution", async () => {
    const { escrow, musd, client, freelancer, id } = await disputed();
    await escrow.connect(freelancer).proposeSettlement(id, 1, E(25));
    const tx = escrow.connect(client).acceptSettlement(id, 1, E(25));
    await expect(tx)
      .to.emit(escrow, "DisputeResolved")
      .withArgs(id, 1n, client.address, E(25), E(35), ResolutionKind.MutualSettlement);
    await expect(tx).to.changeTokenBalances(musd, [freelancer, client, escrow], [E(25), E(35), -E(60)]);
    const m = await escrow.getMilestone(id, 1);
    expect(m.status).to.equal(MS.Resolved);
    expect(m.releasedAmount).to.equal(E(25));
    expect(m.refundedAmount).to.equal(E(35));
    expect(m.settlementProposer).to.equal(ethers.ZeroAddress);
    expect(m.proposedFreelancerAmount).to.equal(0n);
    const p = await escrow.getProject(id);
    expect(p.openDisputes).to.equal(0n);
    expect(p.releasedAmount).to.equal(E(25));
    expect(p.refundedAmount).to.equal(E(35));
    await assertInvariants(escrow, musd);
  });

  it("0 % and 100 % settlements transfer only to one side", async () => {
    const { escrow, musd, client, freelancer, id } = await disputed();
    await escrow.connect(freelancer).proposeSettlement(id, 1, 0);
    const tx = escrow.connect(client).acceptSettlement(id, 1, 0);
    await expect(tx).to.changeTokenBalances(musd, [freelancer, client], [0n, E(60)]);
    await escrow.connect(freelancer).openDispute(id, 0, REASON);
    await escrow.connect(client).proposeSettlement(id, 0, E(40));
    await expect(escrow.connect(freelancer).acceptSettlement(id, 0, E(40))).to.changeTokenBalances(
      musd,
      [freelancer, client],
      [E(40), 0n],
    );
    await assertInvariants(escrow, musd);
  });

  it("resolving the last live milestone closes the project as Completed", async () => {
    const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
    const id = await activeProject(escrow, musd, client, freelancer, { amounts: [E(10)] });
    await escrow.connect(client).openDispute(id, 0, REASON);
    await escrow.connect(client).proposeSettlement(id, 0, E(5));
    await expect(escrow.connect(freelancer).acceptSettlement(id, 0, E(5)))
      .to.emit(escrow, "ProjectClosed")
      .withArgs(id, PS.Completed);
  });
});

describe("EscrowFlow · arbiter resolution", () => {
  async function disputed() {
    const ctx = await disputable();
    await ctx.escrow.connect(ctx.freelancer).openDispute(ctx.id, 1, REASON);
    return ctx;
  }

  for (const [label, share] of [
    ["0 % (full refund)", 0n],
    ["100 % (full payment)", E(60)],
    ["partial 33.333…", E(60) / 3n],
  ] as const) {
    it(`arbiter rules ${label}`, async () => {
      const { escrow, musd, client, freelancer, arbiter, id } = await disputed();
      const tx = escrow.connect(arbiter).arbiterResolve(id, 1, share);
      await expect(tx)
        .to.emit(escrow, "DisputeResolved")
        .withArgs(id, 1n, arbiter.address, share, E(60) - share, ResolutionKind.Arbiter);
      await expect(tx).to.changeTokenBalances(musd, [freelancer, client, arbiter, escrow], [share, E(60) - share, 0n, -E(60)]);
      expect(await milestoneStatus(escrow, id, 1)).to.equal(MS.Resolved);
      await assertInvariants(escrow, musd);
    });
  }

  it("arbiter cannot award more than the milestone amount", async () => {
    const { escrow, arbiter, id } = await disputed();
    await expect(escrow.connect(arbiter).arbiterResolve(id, 1, E(61))).to.be.revertedWithCustomError(
      escrow,
      "SettlementExceedsAmount",
    );
  });

  it("arbiter cannot touch non-disputed milestones", async () => {
    const { escrow, arbiter, id } = await disputed();
    await expect(escrow.connect(arbiter).arbiterResolve(id, 0, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Pending);
  });

  it("arbiter ruling supersedes a standing settlement proposal", async () => {
    const { escrow, musd, client, freelancer, arbiter, id } = await disputed();
    await escrow.connect(client).proposeSettlement(id, 1, E(5));
    await escrow.connect(arbiter).arbiterResolve(id, 1, E(50));
    await expect(escrow.connect(freelancer).acceptSettlement(id, 1, E(5)))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Resolved);
    await assertInvariants(escrow, musd);
  });
});

describe("EscrowFlow · dispute withdrawal", () => {
  it("only the initiator can withdraw", async () => {
    const { escrow, client, freelancer, stranger, id } = await disputable();
    await escrow.connect(client).openDispute(id, 1, REASON);
    for (const s of [freelancer, stranger]) {
      await expect(escrow.connect(s).withdrawDispute(id, 1)).to.be.revertedWithCustomError(escrow, "NotDisputeInitiator");
    }
  });

  it("withdrawing restores Submitted with a fresh review window", async () => {
    const { escrow, musd, client, freelancer, id } = await disputable();
    await escrow.connect(client).openDispute(id, 1, REASON);
    await time.increase(10 * DAY);
    await expect(escrow.connect(client).withdrawDispute(id, 1))
      .to.emit(escrow, "DisputeWithdrawn")
      .withArgs(id, 1n, client.address);
    const now = BigInt(await time.latest());
    const m = await escrow.getMilestone(id, 1);
    expect(m.status).to.equal(MS.Submitted);
    expect(m.submittedAt).to.equal(now);
    expect(m.disputeInitiator).to.equal(ethers.ZeroAddress);
    expect((await escrow.getProject(id)).openDisputes).to.equal(0n);
    // the claim clock restarted: not claimable yet
    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 1))
      .to.be.revertedWithCustomError(escrow, "ReviewWindowOpen")
      .withArgs(now + BigInt(3 * DAY));
    await assertInvariants(escrow, musd);
  });

  it("withdrawing restores ChangesRequested with a fresh changesRequestedAt", async () => {
    const { escrow, client, freelancer, id } = await disputable();
    await escrow.connect(client).requestChanges(id, 1, REASON);
    await escrow.connect(freelancer).openDispute(id, 1, REASON);
    await time.increase(DAY);
    await escrow.connect(freelancer).withdrawDispute(id, 1);
    const m = await escrow.getMilestone(id, 1);
    expect(m.status).to.equal(MS.ChangesRequested);
    expect(m.changesRequestedAt).to.equal(BigInt(await time.latest()));
  });

  it("withdrawing restores Pending; a standing proposal does not survive a re-opened dispute", async () => {
    const { escrow, client, freelancer, id } = await disputable();
    await escrow.connect(client).openDispute(id, 0, REASON);
    await escrow.connect(client).proposeSettlement(id, 0, E(1));
    await escrow.connect(client).withdrawDispute(id, 0);
    expect(await milestoneStatus(escrow, id, 0)).to.equal(MS.Pending);
    await escrow.connect(freelancer).openDispute(id, 0, REASON);
    await expect(escrow.connect(freelancer).acceptSettlement(id, 0, E(1))).to.be.revertedWithCustomError(
      escrow,
      "NoSettlementProposal",
    );
  });

  it("cannot withdraw a non-disputed milestone", async () => {
    const { escrow, client, id } = await disputable();
    await expect(escrow.connect(client).withdrawDispute(id, 1))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Submitted);
  });
});
