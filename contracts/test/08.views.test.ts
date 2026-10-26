import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { baseFixture, activeProject, createProject, MS, E, DAY, SUB, REASON, TERMS } from "./helpers";

describe("EscrowFlow · views", () => {
  async function funded() {
    const ctx = await loadFixture(baseFixture);
    const id = await activeProject(ctx.escrow, ctx.musd, ctx.client, ctx.freelancer, {
      deadlineReclaim: true,
      reclaimGracePeriod: 2 * DAY,
    });
    return { ...ctx, id };
  }

  it("getMilestones mirrors getMilestone for every index", async () => {
    const { escrow, freelancer, id } = await funded();
    await escrow.connect(freelancer).submitMilestone(id, 2, SUB());
    const all = await escrow.getMilestones(id);
    expect(all.length).to.equal(4);
    for (let i = 0; i < 4; i++) {
      const one = await escrow.getMilestone(id, i);
      expect(one.amount).to.equal(all[i].amount);
      expect(one.status).to.equal(all[i].status);
      expect(one.submissionHash).to.equal(all[i].submissionHash);
    }
    expect(all[2].status).to.equal(MS.Submitted);
  });

  it("reviewDeadline is submittedAt + reviewPeriod only while Submitted", async () => {
    const { escrow, client, freelancer, id } = await funded();
    expect(await escrow.reviewDeadline(id, 0)).to.equal(0n);
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    const m = await escrow.getMilestone(id, 0);
    expect(await escrow.reviewDeadline(id, 0)).to.equal(m.submittedAt + m.reviewPeriod);
    await escrow.connect(client).requestChanges(id, 0, REASON);
    expect(await escrow.reviewDeadline(id, 0)).to.equal(0n);
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB(2));
    await escrow.connect(client).approveAndRelease(id, 0);
    expect(await escrow.reviewDeadline(id, 0)).to.equal(0n);
  });

  it("reclaimAvailableAt is deadline + grace for Pending, 0 once submitted / settled", async () => {
    const { escrow, client, freelancer, id } = await funded();
    const m1 = await escrow.getMilestone(id, 1);
    expect(await escrow.reclaimAvailableAt(id, 1)).to.equal(m1.deadline + BigInt(2 * DAY));
    await escrow.connect(freelancer).submitMilestone(id, 1, SUB());
    expect(await escrow.reclaimAvailableAt(id, 1)).to.equal(0n);
    await escrow.connect(client).approveAndRelease(id, 1);
    expect(await escrow.reclaimAvailableAt(id, 1)).to.equal(0n);
  });

  it("heldAmount is 0 before funding and tracks funded − released − refunded after", async () => {
    const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
    const id = await createProject(escrow, client, { freelancer: freelancer.address });
    expect(await escrow.heldAmount(id)).to.equal(0n);
    const id2 = await activeProject(escrow, musd, client, freelancer);
    await escrow.connect(freelancer).submitMilestone(id2, 3, SUB());
    await escrow.connect(client).approveAndRelease(id2, 3);
    expect(await escrow.heldAmount(id2)).to.equal(E(160));
  });

  it("every read and write on an unknown project reverts ProjectNotFound", async () => {
    const { escrow, client, freelancer } = await loadFixture(baseFixture);
    const bad = 404n;
    const reads = [
      () => escrow.getProject(bad),
      () => escrow.getProject(0n),
      () => escrow.getMilestone(bad, 0),
      () => escrow.getMilestones(bad),
      () => escrow.heldAmount(bad),
      () => escrow.reviewDeadline(bad, 0),
      () => escrow.reclaimAvailableAt(bad, 0),
    ];
    for (const r of reads) await expect(r()).to.be.revertedWithCustomError(escrow, "ProjectNotFound");
    const params = {
      freelancer: freelancer.address,
      arbiter: ethers.ZeroAddress,
      termsHash: TERMS,
      autoRelease: false,
      deadlineReclaim: false,
      reclaimGracePeriod: 0,
      amounts: [E(1)],
      deadlines: [BigInt(await time.latest()) + BigInt(DAY)],
      reviewPeriods: [DAY],
    };
    const writes = [
      () => escrow.connect(client).updateTerms(bad, params),
      () => escrow.connect(freelancer).acceptTerms(bad, TERMS, 1),
      () => escrow.connect(freelancer).revokeAcceptance(bad),
      () => escrow.connect(client).cancelUnfunded(bad),
      () => escrow.connect(client).fund(bad),
      () => escrow.connect(freelancer).submitMilestone(bad, 0, SUB()),
      () => escrow.connect(client).requestChanges(bad, 0, REASON),
      () => escrow.connect(client).approveAndRelease(bad, 0),
      () => escrow.connect(freelancer).claimAfterReviewTimeout(bad, 0),
      () => escrow.connect(client).reclaimExpiredMilestone(bad, 0),
      () => escrow.connect(client).openDispute(bad, 0, REASON),
      () => escrow.connect(client).proposeSettlement(bad, 0, 0),
      () => escrow.connect(client).acceptSettlement(bad, 0, 0),
      () => escrow.connect(client).arbiterResolve(bad, 0, 0),
      () => escrow.connect(client).withdrawDispute(bad, 0),
      () => escrow.connect(client).proposeCancellation(bad),
      () => escrow.connect(client).revokeCancellation(bad),
      () => escrow.connect(client).acceptCancellation(bad),
    ];
    for (const w of writes) await expect(w()).to.be.revertedWithCustomError(escrow, "ProjectNotFound").withArgs(bad);
  });

  it("out-of-range milestone indexes revert InvalidMilestoneIndex", async () => {
    const { escrow, client, freelancer, id } = await funded();
    await expect(escrow.getMilestone(id, 4)).to.be.revertedWithCustomError(escrow, "InvalidMilestoneIndex").withArgs(4n);
    await expect(escrow.reviewDeadline(id, 7)).to.be.revertedWithCustomError(escrow, "InvalidMilestoneIndex").withArgs(7n);
    await expect(escrow.reclaimAvailableAt(id, 4)).to.be.revertedWithCustomError(escrow, "InvalidMilestoneIndex");
    await expect(escrow.connect(client).approveAndRelease(id, 4)).to.be.revertedWithCustomError(escrow, "InvalidMilestoneIndex");
    await expect(escrow.connect(freelancer).openDispute(id, 99, REASON)).to.be.revertedWithCustomError(
      escrow,
      "InvalidMilestoneIndex",
    );
  });
});
