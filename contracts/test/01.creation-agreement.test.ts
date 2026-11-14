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
  PS,
  MS,
  E,
  DAY,
  TERMS,
  hashOf,
  SPEC_AMOUNTS,
  ID_OFFSET,
  pid,
} from "./helpers";

describe("EscrowFlow · deployment", () => {
  it("binds the immutable token, savings vault and id offset and exposes the rule constants", async () => {
    const { escrow, musd, vault } = await loadFixture(baseFixture);
    expect(await escrow.token()).to.equal(await musd.getAddress());
    expect(await escrow.savingsVault()).to.equal(await vault.getAddress());
    expect(await escrow.ID_OFFSET()).to.equal(ID_OFFSET);
    expect(await escrow.MIN_RECLAIM_GRACE()).to.equal(60n);
    expect(await escrow.totalYieldPrincipal()).to.equal(0n);
    expect(await escrow.accYieldPerPrincipal()).to.equal(0n);
    expect(await escrow.unattributedYield()).to.equal(0n);
    expect(await escrow.MAX_MILESTONES()).to.equal(20n);
    expect(await escrow.MIN_REVIEW_PERIOD()).to.equal(60n);
    expect(await escrow.MAX_REVIEW_PERIOD()).to.equal(BigInt(90 * DAY));
    expect(await escrow.MAX_RECLAIM_GRACE()).to.equal(BigInt(90 * DAY));
    expect(await escrow.projectCount()).to.equal(0n);
    expect(await escrow.totalHeld()).to.equal(0n);
  });

  it("rejects a zero token address", async () => {
    const factory = await ethers.getContractFactory("EscrowFlow");
    await expect(factory.deploy(ethers.ZeroAddress, ethers.ZeroAddress, ID_OFFSET)).to.be.revertedWithCustomError(
      factory,
      "ZeroAddress",
    );
  });

  it("rejects a savings vault whose musdToken() is not the escrow token (VaultMismatch)", async () => {
    const { musd } = await loadFixture(baseFixture);
    const other = await ethers.deployContract("MockMUSD");
    const otherVault = await ethers.deployContract("MockSavingsVault", [await other.getAddress()]);
    const factory = await ethers.getContractFactory("EscrowFlow");
    await expect(factory.deploy(await musd.getAddress(), await otherVault.getAddress(), ID_OFFSET)).to.be.revertedWithCustomError(
      factory,
      "VaultMismatch",
    );
  });

  it("deploys without a vault (yield unavailable) and with any id offset", async () => {
    const { musd } = await loadFixture(baseFixture);
    const escrow = await ethers.deployContract("EscrowFlow", [await musd.getAddress(), ethers.ZeroAddress, 0]);
    expect(await escrow.savingsVault()).to.equal(ethers.ZeroAddress);
    expect(await escrow.ID_OFFSET()).to.equal(0n);
  });

  it("has no owner / admin / withdraw surface", async () => {
    const { escrow } = await loadFixture(baseFixture);
    const names = escrow.interface.fragments.filter((f) => f.type === "function").map((f: any) => f.name as string);
    for (const forbidden of ["owner", "transferOwnership", "withdraw", "sweep", "rescue", "pause", "upgradeTo", "setToken"]) {
      expect(names, forbidden).to.not.include(forbidden);
    }
  });
});

describe("EscrowFlow · escrow creation", () => {
  it("creates a project with the spec 40/60/60/40 milestones and emits ProjectCreated + TermsSet", async () => {
    const { escrow, client, freelancer, arbiter } = await loadFixture(baseFixture);
    const params = await makeParams({
      freelancer: freelancer.address,
      arbiter: arbiter.address,
      autoRelease: true,
      deadlineReclaim: true,
      reclaimGracePeriod: 2 * DAY,
    });
    const tx = escrow.connect(client).createProject(params);
    const id = pid(1);
    await expect(tx).to.emit(escrow, "ProjectCreated").withArgs(id, client.address, freelancer.address);
    await expect(tx)
      .to.emit(escrow, "TermsSet")
      .withArgs(id, 1, TERMS, freelancer.address, arbiter.address, E(200), 4, true, true, 2 * DAY);
    await expect(tx).to.emit(escrow, "YieldTermsSet").withArgs(id, 1, false, 0);

    const p = await escrow.getProject(id);
    expect(p.client).to.equal(client.address);
    expect(p.freelancer).to.equal(freelancer.address);
    expect(p.arbiter).to.equal(arbiter.address);
    expect(p.status).to.equal(PS.AwaitingAcceptance);
    expect(p.termsVersion).to.equal(1n);
    expect(p.acceptedVersion).to.equal(0n);
    expect(p.termsHash).to.equal(TERMS);
    expect(p.totalAmount).to.equal(E(200));
    expect(p.fundedAmount).to.equal(0n);
    expect(p.milestoneCount).to.equal(4n);
    expect(p.autoRelease).to.equal(true);
    expect(p.deadlineReclaim).to.equal(true);
    expect(p.reclaimGracePeriod).to.equal(BigInt(2 * DAY));
    expect(p.createdAt).to.equal(BigInt(await time.latest()));

    const ms = await escrow.getMilestones(id);
    expect(ms.length).to.equal(4);
    for (let i = 0; i < 4; i++) {
      expect(ms[i].amount).to.equal(SPEC_AMOUNTS[i]);
      expect(ms[i].deadline).to.equal(params.deadlines[i]);
      expect(ms[i].reviewPeriod).to.equal(BigInt(params.reviewPeriods[i]));
      expect(ms[i].status).to.equal(MS.Pending);
      expect(ms[i].revision).to.equal(0n);
      expect(ms[i].pausedFor).to.equal(0n);
    }
    expect(await escrow.heldAmount(id)).to.equal(0n);
    const y = await escrow.getYield(id);
    expect([y.enabled, y.freelancerBps, y.principal, y.accrued, y.paid]).to.deep.equal([false, 0n, 0n, 0n, 0n]);
  });

  it("assigns sequential ids starting at ID_OFFSET + 1 and indexes projects by client and freelancer", async () => {
    const { escrow, client, client2, freelancer, freelancer2 } = await loadFixture(baseFixture);
    await createProject(escrow, client, { freelancer: freelancer.address });
    await createProject(escrow, client, { freelancer: freelancer2.address });
    await createProject(escrow, client2, { freelancer: freelancer.address });
    expect(await escrow.projectCount()).to.equal(3n);
    expect(await escrow.projectsOfClient(client.address)).to.deep.equal([pid(1), pid(2)]);
    expect(await escrow.projectsOfClient(client2.address)).to.deep.equal([pid(3)]);
    expect(await escrow.projectsOfFreelancer(freelancer.address)).to.deep.equal([pid(1), pid(3)]);
    expect(await escrow.projectsOfFreelancer(freelancer2.address)).to.deep.equal([pid(2)]);
    expect(pid(1)).to.equal(1001n);
  });

  it("accepts exactly MAX_MILESTONES (20) milestones", async () => {
    const { escrow, client, freelancer } = await loadFixture(baseFixture);
    const amounts = Array.from({ length: 20 }, () => E(1));
    const id = await createProject(escrow, client, { freelancer: freelancer.address, amounts });
    expect((await escrow.getProject(id)).milestoneCount).to.equal(20n);
    expect((await escrow.getProject(id)).totalAmount).to.equal(E(20));
  });

  it("accepts boundary review periods (60 s and 90 days) and grace (90 days)", async () => {
    const { escrow, client, freelancer } = await loadFixture(baseFixture);
    const id = await createProject(escrow, client, {
      freelancer: freelancer.address,
      amounts: [E(1), E(2)],
      reviewPeriods: [60, 90 * DAY],
      reclaimGracePeriod: 90 * DAY,
    });
    const ms = await escrow.getMilestones(id);
    expect(ms[0].reviewPeriod).to.equal(60n);
    expect(ms[1].reviewPeriod).to.equal(BigInt(90 * DAY));
  });

  describe("validation", () => {
    it("reverts ZeroAddress for a zero freelancer", async () => {
      const { escrow, client } = await loadFixture(baseFixture);
      const params = await makeParams({ freelancer: ethers.ZeroAddress });
      await expect(escrow.connect(client).createProject(params)).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("reverts InvalidParty when client == freelancer", async () => {
      const { escrow, client } = await loadFixture(baseFixture);
      const params = await makeParams({ freelancer: client.address });
      await expect(escrow.connect(client).createProject(params)).to.be.revertedWithCustomError(escrow, "InvalidParty");
    });

    it("reverts InvalidParty when the freelancer is the escrow contract or the token", async () => {
      const { escrow, musd, client } = await loadFixture(baseFixture);
      for (const bad of [await escrow.getAddress(), await musd.getAddress()]) {
        const params = await makeParams({ freelancer: bad });
        await expect(escrow.connect(client).createProject(params)).to.be.revertedWithCustomError(escrow, "InvalidParty");
      }
    });

    it("reverts InvalidParty when the arbiter is the client, the freelancer or the escrow", async () => {
      const { escrow, client, freelancer } = await loadFixture(baseFixture);
      for (const bad of [client.address, freelancer.address, await escrow.getAddress()]) {
        const params = await makeParams({ freelancer: freelancer.address, arbiter: bad });
        await expect(escrow.connect(client).createProject(params)).to.be.revertedWithCustomError(escrow, "InvalidParty");
      }
    });

    it("reverts EmptyTermsHash for a zero terms hash", async () => {
      const { escrow, client, freelancer } = await loadFixture(baseFixture);
      const params = await makeParams({ freelancer: freelancer.address, termsHash: ethers.ZeroHash });
      await expect(escrow.connect(client).createProject(params)).to.be.revertedWithCustomError(escrow, "EmptyTermsHash");
    });

    it("reverts InvalidMilestoneCount for 0 or 21 milestones", async () => {
      const { escrow, client, freelancer } = await loadFixture(baseFixture);
      const none = await makeParams({ freelancer: freelancer.address, amounts: [], deadlines: [], reviewPeriods: [] });
      await expect(escrow.connect(client).createProject(none)).to.be.revertedWithCustomError(escrow, "InvalidMilestoneCount");
      const many = await makeParams({ freelancer: freelancer.address, amounts: Array.from({ length: 21 }, () => E(1)) });
      await expect(escrow.connect(client).createProject(many)).to.be.revertedWithCustomError(escrow, "InvalidMilestoneCount");
    });

    it("reverts LengthMismatch when deadlines or review periods do not match amounts", async () => {
      const { escrow, client, freelancer } = await loadFixture(baseFixture);
      const now = BigInt(await time.latest());
      const p1 = await makeParams({ freelancer: freelancer.address, deadlines: [now + BigInt(DAY)] });
      await expect(escrow.connect(client).createProject(p1)).to.be.revertedWithCustomError(escrow, "LengthMismatch");
      const p2 = await makeParams({ freelancer: freelancer.address, reviewPeriods: [DAY, DAY, DAY] });
      await expect(escrow.connect(client).createProject(p2)).to.be.revertedWithCustomError(escrow, "LengthMismatch");
    });

    it("reverts InvalidGracePeriod above 90 days", async () => {
      const { escrow, client, freelancer } = await loadFixture(baseFixture);
      const params = await makeParams({ freelancer: freelancer.address, reclaimGracePeriod: 90 * DAY + 1 });
      await expect(escrow.connect(client).createProject(params)).to.be.revertedWithCustomError(escrow, "InvalidGracePeriod");
    });

    it("reverts ZeroAmount(index) for a zero milestone amount (invalid milestone amounts)", async () => {
      const { escrow, client, freelancer } = await loadFixture(baseFixture);
      const params = await makeParams({ freelancer: freelancer.address, amounts: [E(40), E(60), 0n, E(40)] });
      await expect(escrow.connect(client).createProject(params))
        .to.be.revertedWithCustomError(escrow, "ZeroAmount")
        .withArgs(2n);
    });

    it("reverts AmountOverflow when the milestone sum exceeds uint128 (invalid milestone amounts)", async () => {
      const { escrow, client, freelancer } = await loadFixture(baseFixture);
      const half = 1n << 127n;
      const params = await makeParams({ freelancer: freelancer.address, amounts: [half, half] });
      await expect(escrow.connect(client).createProject(params)).to.be.revertedWithCustomError(escrow, "AmountOverflow");
      // max uint128 in a single milestone is fine
      const max = (1n << 128n) - 1n;
      const ok = await makeParams({ freelancer: freelancer.address, amounts: [max] });
      await expect(escrow.connect(client).createProject(ok)).to.not.be.reverted;
    });

    it("reverts InvalidDeadline(index) for past, current or beyond-horizon deadlines", async () => {
      const { escrow, client, freelancer } = await loadFixture(baseFixture);
      const now = BigInt(await time.latest());
      const past = await makeParams({
        freelancer: freelancer.address,
        amounts: [E(1), E(1)],
        deadlines: [now + BigInt(DAY), now - 1n],
      });
      await expect(escrow.connect(client).createProject(past))
        .to.be.revertedWithCustomError(escrow, "InvalidDeadline")
        .withArgs(1n);

      const horizon = BigInt(5 * 365 * DAY);
      const far = await makeParams({
        freelancer: freelancer.address,
        amounts: [E(1)],
        deadlines: [now + horizon + BigInt(DAY)],
      });
      await expect(escrow.connect(client).createProject(far))
        .to.be.revertedWithCustomError(escrow, "InvalidDeadline")
        .withArgs(0n);

      // deadline equal to the inclusion block timestamp is rejected
      const next = now + 10n;
      await time.setNextBlockTimestamp(next);
      const same = await makeParams({ freelancer: freelancer.address, amounts: [E(1)], deadlines: [next] });
      await expect(escrow.connect(client).createProject(same))
        .to.be.revertedWithCustomError(escrow, "InvalidDeadline")
        .withArgs(0n);
    });

    it("reverts InvalidReviewPeriod(index) below 60 s or above 90 days", async () => {
      const { escrow, client, freelancer } = await loadFixture(baseFixture);
      const low = await makeParams({ freelancer: freelancer.address, amounts: [E(1), E(1)], reviewPeriods: [DAY, 59] });
      await expect(escrow.connect(client).createProject(low))
        .to.be.revertedWithCustomError(escrow, "InvalidReviewPeriod")
        .withArgs(1n);
      const high = await makeParams({ freelancer: freelancer.address, amounts: [E(1)], reviewPeriods: [90 * DAY + 1] });
      await expect(escrow.connect(client).createProject(high))
        .to.be.revertedWithCustomError(escrow, "InvalidReviewPeriod")
        .withArgs(0n);
    });
  });
});

describe("EscrowFlow · agreement validation", () => {
  async function created() {
    const ctx = await loadFixture(baseFixture);
    const id = await createProject(ctx.escrow, ctx.client, { freelancer: ctx.freelancer.address });
    return { ...ctx, id };
  }

  it("freelancer accepts the exact current terms → AwaitingFunding + TermsAccepted", async () => {
    const { escrow, freelancer, id } = await created();
    await expect(escrow.connect(freelancer).acceptTerms(id, TERMS, 1))
      .to.emit(escrow, "TermsAccepted")
      .withArgs(id, freelancer.address, 1, TERMS);
    const p = await escrow.getProject(id);
    expect(p.status).to.equal(PS.AwaitingFunding);
    expect(p.acceptedVersion).to.equal(1n);
  });

  it("rejects acceptance with a wrong terms hash", async () => {
    const { escrow, freelancer, id } = await created();
    await expect(escrow.connect(freelancer).acceptTerms(id, hashOf("something else"), 1)).to.be.revertedWithCustomError(
      escrow,
      "TermsMismatch",
    );
  });

  it("rejects acceptance with a wrong terms version", async () => {
    const { escrow, freelancer, id } = await created();
    await expect(escrow.connect(freelancer).acceptTerms(id, TERMS, 2)).to.be.revertedWithCustomError(escrow, "TermsMismatch");
    await expect(escrow.connect(freelancer).acceptTerms(id, TERMS, 0)).to.be.revertedWithCustomError(escrow, "TermsMismatch");
  });

  it("rejects acceptance by anyone but the named freelancer", async () => {
    const { escrow, client, stranger, arbiter, id } = await created();
    for (const s of [client, stranger, arbiter]) {
      await expect(escrow.connect(s).acceptTerms(id, TERMS, 1)).to.be.revertedWithCustomError(escrow, "NotFreelancer");
    }
  });

  it("rejects a second acceptance (wrong status) and acceptance of an unknown project", async () => {
    const { escrow, freelancer, id } = await created();
    await escrow.connect(freelancer).acceptTerms(id, TERMS, 1);
    await expect(escrow.connect(freelancer).acceptTerms(id, TERMS, 1))
      .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
      .withArgs(PS.AwaitingFunding);
    await expect(escrow.connect(freelancer).acceptTerms(99n, TERMS, 1))
      .to.be.revertedWithCustomError(escrow, "ProjectNotFound")
      .withArgs(99n);
    // ids up to the offset belong to the legacy registry, never to this one
    await expect(escrow.getProject(1n)).to.be.revertedWithCustomError(escrow, "ProjectNotFound").withArgs(1n);
    await expect(escrow.getProject(ID_OFFSET)).to.be.revertedWithCustomError(escrow, "ProjectNotFound");
  });

  it("updateTerms bumps the version, resets acceptance and emits TermsSet", async () => {
    const { escrow, musd, client, freelancer, id } = await created();
    await acceptCurrent(escrow, freelancer, id);
    const v2 = hashOf("terms-v2");
    const params = await makeParams({ freelancer: freelancer.address, termsHash: v2, amounts: [E(100), E(100)] });
    await expect(escrow.connect(client).updateTerms(id, params))
      .to.emit(escrow, "TermsSet")
      .withArgs(id, 2, v2, freelancer.address, ethers.ZeroAddress, E(200), 2, false, false, DAY)
      .and.to.emit(escrow, "YieldTermsSet")
      .withArgs(id, 2, false, 0);
    const p = await escrow.getProject(id);
    expect(p.status).to.equal(PS.AwaitingAcceptance);
    expect(p.acceptedVersion).to.equal(0n);
    expect(p.termsVersion).to.equal(2n);
    expect(p.termsHash).to.equal(v2);
    // the client cannot fund until the freelancer re-accepts
    await musd.connect(client).approve(await escrow.getAddress(), E(200));
    await expect(escrow.connect(client).fund(id))
      .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
      .withArgs(PS.AwaitingAcceptance);
    await escrow.connect(freelancer).acceptTerms(id, v2, 2);
    expect((await escrow.getProject(id)).status).to.equal(PS.AwaitingFunding);
  });

  it("updateTerms re-validates params and is client-only", async () => {
    const { escrow, client, freelancer, stranger, id } = await created();
    const bad = await makeParams({ freelancer: freelancer.address, amounts: [0n] });
    await expect(escrow.connect(client).updateTerms(id, bad)).to.be.revertedWithCustomError(escrow, "ZeroAmount");
    const good = await makeParams({ freelancer: freelancer.address });
    await expect(escrow.connect(freelancer).updateTerms(id, good)).to.be.revertedWithCustomError(escrow, "NotClient");
    await expect(escrow.connect(stranger).updateTerms(id, good)).to.be.revertedWithCustomError(escrow, "NotClient");
  });

  it("stale acceptance is impossible: an edit front-running the freelancer's accept makes it revert (even with the same hash)", async () => {
    const { escrow, client, freelancer, id } = await created();
    // Client silently changes the amounts but keeps the same document hash.
    const sneaky = await makeParams({ freelancer: freelancer.address, amounts: [E(1), E(1), E(1), E(1)] });
    await escrow.connect(client).updateTerms(id, sneaky);
    // Freelancer's transaction was prepared against version 1.
    await expect(escrow.connect(freelancer).acceptTerms(id, TERMS, 1)).to.be.revertedWithCustomError(escrow, "TermsMismatch");
  });

  it("changing the freelancer re-indexes, only the new freelancer can accept, and no duplicate index entries", async () => {
    const { escrow, client, freelancer, freelancer2, id } = await created();
    await escrow.connect(client).updateTerms(id, await makeParams({ freelancer: freelancer2.address }));
    expect(await escrow.projectsOfFreelancer(freelancer2.address)).to.deep.equal([id]);
    // documented: the old freelancer keeps a stale index entry; `freelancer` field is authoritative
    expect(await escrow.projectsOfFreelancer(freelancer.address)).to.deep.equal([id]);
    expect((await escrow.getProject(id)).freelancer).to.equal(freelancer2.address);
    await expect(escrow.connect(freelancer).acceptTerms(id, TERMS, 2)).to.be.revertedWithCustomError(escrow, "NotFreelancer");
    // switch back: no duplicate entry is pushed
    await escrow.connect(client).updateTerms(id, await makeParams({ freelancer: freelancer.address }));
    expect(await escrow.projectsOfFreelancer(freelancer.address)).to.deep.equal([id]);
    await expect(escrow.connect(freelancer).acceptTerms(id, TERMS, 3)).to.emit(escrow, "TermsAccepted");
  });

  it("shrinking the milestone list clears removed milestones; growing again writes fresh ones", async () => {
    const { escrow, client, freelancer, id } = await created();
    await escrow.connect(client).updateTerms(id, await makeParams({ freelancer: freelancer.address, amounts: [E(5), E(7)] }));
    expect((await escrow.getMilestones(id)).length).to.equal(2);
    expect((await escrow.getProject(id)).totalAmount).to.equal(E(12));
    await expect(escrow.getMilestone(id, 2)).to.be.revertedWithCustomError(escrow, "InvalidMilestoneIndex").withArgs(2n);

    await escrow
      .connect(client)
      .updateTerms(id, await makeParams({ freelancer: freelancer.address, amounts: [E(1), E(2), E(3)] }));
    const ms = await escrow.getMilestones(id);
    expect(ms.map((m) => m.amount)).to.deep.equal([E(1), E(2), E(3)]);
    expect(ms[2].status).to.equal(MS.Pending);
    expect(ms[2].revision).to.equal(0n);
    expect((await escrow.getProject(id)).totalAmount).to.equal(E(6));
  });

  it("freelancer can revoke acceptance before funding; then funding is impossible", async () => {
    const { escrow, musd, client, freelancer, stranger, id } = await created();
    await expect(escrow.connect(freelancer).revokeAcceptance(id))
      .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
      .withArgs(PS.AwaitingAcceptance);
    await acceptCurrent(escrow, freelancer, id);
    await expect(escrow.connect(stranger).revokeAcceptance(id)).to.be.revertedWithCustomError(escrow, "NotFreelancer");
    await expect(escrow.connect(client).revokeAcceptance(id)).to.be.revertedWithCustomError(escrow, "NotFreelancer");
    await expect(escrow.connect(freelancer).revokeAcceptance(id))
      .to.emit(escrow, "AcceptanceRevoked")
      .withArgs(id, freelancer.address, 1);
    const p = await escrow.getProject(id);
    expect(p.status).to.equal(PS.AwaitingAcceptance);
    expect(p.acceptedVersion).to.equal(0n);
    await musd.connect(client).approve(await escrow.getAddress(), E(200));
    await expect(escrow.connect(client).fund(id))
      .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
      .withArgs(PS.AwaitingAcceptance);
  });

  it("terms cannot be edited after funding", async () => {
    const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
    const id = await activeProject(escrow, musd, client, freelancer);
    await expect(escrow.connect(client).updateTerms(id, await makeParams({ freelancer: freelancer.address })))
      .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
      .withArgs(PS.Active);
  });

  describe("unfunded cancellation", () => {
    it("client cancels before acceptance and after acceptance; no funds move", async () => {
      const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
      const a = await createProject(escrow, client, { freelancer: freelancer.address });
      const b = await createProject(escrow, client, { freelancer: freelancer.address });
      await acceptCurrent(escrow, freelancer, b);
      for (const id of [a, b]) {
        const tx = escrow.connect(client).cancelUnfunded(id);
        await expect(tx).to.emit(escrow, "ProjectCancelled").withArgs(id, client.address, 0n, false);
        await expect(tx).to.emit(escrow, "ProjectClosed").withArgs(id, PS.Cancelled);
        await expect(tx).to.changeTokenBalances(musd, [client, freelancer, escrow], [0n, 0n, 0n]);
        expect((await escrow.getProject(id)).status).to.equal(PS.Cancelled);
      }
      await assertInvariants(escrow, musd);
    });

    it("only the client can cancel an unfunded project", async () => {
      const { escrow, client, freelancer, stranger } = await loadFixture(baseFixture);
      const id = await createProject(escrow, client, { freelancer: freelancer.address });
      for (const s of [freelancer, stranger]) {
        await expect(escrow.connect(s).cancelUnfunded(id)).to.be.revertedWithCustomError(escrow, "NotClient");
      }
    });

    it("a cancelled project cannot be accepted, edited or funded, nor cancelled twice", async () => {
      const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
      const id = await createProject(escrow, client, { freelancer: freelancer.address });
      await escrow.connect(client).cancelUnfunded(id);
      await expect(escrow.connect(freelancer).acceptTerms(id, TERMS, 1))
        .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
        .withArgs(PS.Cancelled);
      await expect(escrow.connect(client).updateTerms(id, await makeParams({ freelancer: freelancer.address })))
        .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
        .withArgs(PS.Cancelled);
      await musd.connect(client).approve(await escrow.getAddress(), E(200));
      await expect(escrow.connect(client).fund(id))
        .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
        .withArgs(PS.Cancelled);
      await expect(escrow.connect(client).cancelUnfunded(id))
        .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
        .withArgs(PS.Cancelled);
    });

    it("cancelUnfunded is impossible once funded (funded projects need mutual cancellation)", async () => {
      const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
      const id = await activeProject(escrow, musd, client, freelancer);
      await expect(escrow.connect(client).cancelUnfunded(id))
        .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
        .withArgs(PS.Active);
    });
  });
});
