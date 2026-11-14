import { ethers } from "hardhat";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployWithToken,
  makeParams,
  createProject,
  acceptCurrent,
  activeProject,
  lastId,
  assertInvariants,
  milestoneStatus,
  MS,
  PS,
  E,
  DAY,
  SUB,
  REASON,
  REENTRANCY_SELECTOR,
} from "./helpers";
import type { EscrowFlow, PartyProxy } from "../typechain-types";

const FaultyMode = { Normal: 0, ReturnFalse: 1, Revert: 2 } as const;

describe("EscrowFlow · failed token transfers", () => {
  async function faultyFunded() {
    const ctx = await deployWithToken("FaultyToken");
    const escrow = ctx.escrow as EscrowFlow;
    const id = await activeProject(escrow, ctx.token, ctx.client, ctx.freelancer, {
      arbiter: ctx.arbiter.address,
      autoRelease: true,
      deadlineReclaim: true,
    });
    return { ...ctx, escrow, id };
  }

  it("a token returning false on release reverts SafeERC20FailedOperation and changes nothing", async () => {
    const { escrow, token, client, freelancer, id } = await faultyFunded();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await token.setMode(FaultyMode.ReturnFalse);
    await expect(escrow.connect(client).approveAndRelease(id, 0))
      .to.be.revertedWithCustomError(escrow, "SafeERC20FailedOperation")
      .withArgs(await token.getAddress());
    expect(await milestoneStatus(escrow, id, 0)).to.equal(MS.Submitted);
    expect((await escrow.getProject(id)).releasedAmount).to.equal(0n);
    expect(await escrow.totalHeld()).to.equal(E(200));
    expect(await escrow.heldAmount(id)).to.equal(E(200));
    await assertInvariants(escrow, token);
  });

  it("a reverting token bubbles the revert and changes nothing", async () => {
    const { escrow, token, client, freelancer, id } = await faultyFunded();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await token.setMode(FaultyMode.Revert);
    await expect(escrow.connect(client).approveAndRelease(id, 0)).to.be.revertedWith("FaultyToken: transfer blocked");
    expect(await milestoneStatus(escrow, id, 0)).to.equal(MS.Submitted);
  });

  it("once the token works again the release succeeds exactly once", async () => {
    const { escrow, token, client, freelancer, id } = await faultyFunded();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await token.setMode(FaultyMode.ReturnFalse);
    await expect(escrow.connect(client).approveAndRelease(id, 0)).to.be.reverted;
    await token.setMode(FaultyMode.Normal);
    await expect(escrow.connect(client).approveAndRelease(id, 0)).to.changeTokenBalances(token, [freelancer], [E(40)]);
    await expect(escrow.connect(client).approveAndRelease(id, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestoneStatus")
      .withArgs(MS.Released);
    await assertInvariants(escrow, token);
  });

  it("failed transfers in claim, reclaim, settlement, arbiter ruling and cancellation are atomic", async () => {
    const { escrow, token, client, freelancer, arbiter, id } = await faultyFunded();
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());
    await escrow.connect(client).openDispute(id, 1, REASON);
    await escrow.connect(client).proposeSettlement(id, 1, E(30));
    await escrow.connect(freelancer).proposeCancellation(id); // set before the clock jump
    await time.increase(365 * DAY);
    await token.setMode(FaultyMode.ReturnFalse);

    await expect(escrow.connect(freelancer).claimAfterReviewTimeout(id, 0)).to.be.revertedWithCustomError(
      escrow,
      "SafeERC20FailedOperation",
    );
    await expect(escrow.connect(client).reclaimExpiredMilestone(id, 2)).to.be.revertedWithCustomError(
      escrow,
      "SafeERC20FailedOperation",
    );
    await expect(escrow.connect(freelancer).acceptSettlement(id, 1, E(30))).to.be.revertedWithCustomError(
      escrow,
      "SafeERC20FailedOperation",
    );
    await expect(escrow.connect(arbiter).arbiterResolve(id, 1, E(10))).to.be.revertedWithCustomError(
      escrow,
      "SafeERC20FailedOperation",
    );
    await expect(escrow.connect(client).acceptCancellation(id, E(140))).to.be.revertedWithCustomError(
      escrow,
      "SafeERC20FailedOperation",
    );

    const p = await escrow.getProject(id);
    expect(p.cancelled).to.equal(false);
    expect(p.cancelProposer).to.equal(freelancer.address);
    expect(p.openDisputes).to.equal(1n);
    expect(p.releasedAmount + p.refundedAmount).to.equal(0n);
    const ms = await escrow.getMilestones(id);
    expect(ms.map((m) => m.status)).to.deep.equal([MS.Submitted, MS.Disputed, MS.Pending, MS.Pending]);
    expect(ms[1].proposedFreelancerAmount).to.equal(E(30));
    await assertInvariants(escrow, token);
  });
});

describe("EscrowFlow · reentrancy", () => {
  async function reentrantSetup() {
    const ctx = await deployWithToken("ReentrantToken");
    const escrow = ctx.escrow as EscrowFlow;
    const proxy = (await ethers.deployContract("PartyProxy")) as unknown as PartyProxy;
    await ctx.token.mint(await proxy.getAddress(), E(100_000));
    const tokenAddr = await ctx.token.getAddress();
    const escrowAddr = await escrow.getAddress();
    // proxy approves the escrow
    await proxy.exec(tokenAddr, ctx.token.interface.encodeFunctionData("approve", [escrowAddr, ethers.MaxUint256]));
    return { ...ctx, escrow, proxy, tokenAddr, escrowAddr };
  }

  const enc = (escrow: EscrowFlow, fn: string, args: unknown[]) => escrow.interface.encodeFunctionData(fn as any, args as any);

  it("token re-entering the escrow during a release is blocked by the guard (ReentrancyGuardReentrantCall)", async () => {
    const { escrow, token, client, freelancer, escrowAddr } = await reentrantSetup();
    const id = await activeProject(escrow, token, client, freelancer);
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB(1));
    await escrow.connect(freelancer).submitMilestone(id, 1, SUB(2));
    await token.arm(escrowAddr, enc(escrow, "approveAndRelease", [id, 1]));
    await expect(escrow.connect(client).approveAndRelease(id, 0)).to.changeTokenBalances(token, [freelancer], [E(40)]);
    expect(await token.reentryAttempts()).to.equal(1n);
    expect(await token.lastReentrySuccess()).to.equal(false);
    expect(await token.lastReentryReturn()).to.equal(REENTRANCY_SELECTOR);
    expect(await milestoneStatus(escrow, id, 1)).to.equal(MS.Submitted);
    await assertInvariants(escrow, token);
  });

  it("an authorised client contract cannot double-release the same milestone via a transfer hook", async () => {
    const { escrow, token, freelancer, proxy, escrowAddr } = await reentrantSetup();
    const proxyAddr = await proxy.getAddress();
    const params = await makeParams({ freelancer: freelancer.address });
    await proxy.exec(escrowAddr, enc(escrow, "createProject", [params]));
    const id = await lastId(escrow);
    expect((await escrow.getProject(id)).client).to.equal(proxyAddr);
    await acceptCurrent(escrow, freelancer, id);
    await proxy.exec(escrowAddr, enc(escrow, "fund", [id]));
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB());

    await proxy.setHook(escrowAddr, enc(escrow, "approveAndRelease", [id, 0]));
    await token.arm(proxyAddr, proxy.interface.encodeFunctionData("hook"));
    await expect(proxy.exec(escrowAddr, enc(escrow, "approveAndRelease", [id, 0]))).to.changeTokenBalances(
      token,
      [freelancer, escrow],
      [E(40), -E(40)],
    );
    expect(await proxy.hookCalled()).to.equal(true);
    expect(await proxy.hookSuccess()).to.equal(false);
    expect(await proxy.hookReturn()).to.equal(REENTRANCY_SELECTOR);
    expect((await escrow.getProject(id)).releasedAmount).to.equal(E(40));
    await assertInvariants(escrow, token);
  });

  it("an authorised freelancer contract cannot claim a second milestone during a claim transfer", async () => {
    const { escrow, token, client, proxy, escrowAddr } = await reentrantSetup();
    const proxyAddr = await proxy.getAddress();
    const id = await createProject(escrow, client, { freelancer: proxyAddr, autoRelease: true });
    const p = await escrow.getProject(id);
    await proxy.exec(escrowAddr, enc(escrow, "acceptTerms", [id, p.termsHash, p.termsVersion]));
    await token.connect(client).approve(escrowAddr, E(200));
    await escrow.connect(client).fund(id);
    await proxy.exec(escrowAddr, enc(escrow, "submitMilestone", [id, 0, SUB(1)]));
    await proxy.exec(escrowAddr, enc(escrow, "submitMilestone", [id, 1, SUB(2)]));
    await time.increase(4 * DAY);

    await proxy.setHook(escrowAddr, enc(escrow, "claimAfterReviewTimeout", [id, 1]));
    await token.arm(proxyAddr, proxy.interface.encodeFunctionData("hook"));
    await expect(proxy.exec(escrowAddr, enc(escrow, "claimAfterReviewTimeout", [id, 0]))).to.changeTokenBalances(
      token,
      [proxy],
      [E(40)],
    );
    expect(await proxy.hookSuccess()).to.equal(false);
    expect(await proxy.hookReturn()).to.equal(REENTRANCY_SELECTOR);
    expect(await milestoneStatus(escrow, id, 1)).to.equal(MS.Submitted);
    // the honest path still works afterwards
    await expect(proxy.exec(escrowAddr, enc(escrow, "claimAfterReviewTimeout", [id, 1]))).to.changeTokenBalances(
      token,
      [proxy],
      [E(60)],
    );
    await assertInvariants(escrow, token);
  });

  it("re-entering acceptCancellation during the refund cannot refund twice", async () => {
    const { escrow, token, freelancer, proxy, escrowAddr } = await reentrantSetup();
    const proxyAddr = await proxy.getAddress();
    await proxy.exec(escrowAddr, enc(escrow, "createProject", [await makeParams({ freelancer: freelancer.address })]));
    const id = await lastId(escrow);
    await acceptCurrent(escrow, freelancer, id);
    await proxy.exec(escrowAddr, enc(escrow, "fund", [id]));
    await escrow.connect(freelancer).proposeCancellation(id);

    await proxy.setHook(escrowAddr, enc(escrow, "acceptCancellation", [id, E(200)]));
    await token.arm(proxyAddr, proxy.interface.encodeFunctionData("hook"));
    await expect(proxy.exec(escrowAddr, enc(escrow, "acceptCancellation", [id, E(200)]))).to.changeTokenBalances(
      token,
      [proxy, escrow],
      [E(200), -E(200)],
    );
    expect(await proxy.hookSuccess()).to.equal(false);
    expect(await proxy.hookReturn()).to.equal(REENTRANCY_SELECTOR);
    expect((await escrow.getProject(id)).status).to.equal(PS.Cancelled);
    await assertInvariants(escrow, token);
  });

  it("re-entering fund during the deposit pull is blocked; the project is funded exactly once", async () => {
    const { escrow, token, freelancer, proxy, escrowAddr } = await reentrantSetup();
    const proxyAddr = await proxy.getAddress();
    await proxy.exec(escrowAddr, enc(escrow, "createProject", [await makeParams({ freelancer: freelancer.address })]));
    const id = await lastId(escrow);
    await acceptCurrent(escrow, freelancer, id);
    await proxy.setHook(escrowAddr, enc(escrow, "fund", [id]));
    await token.arm(proxyAddr, proxy.interface.encodeFunctionData("hook"));
    await expect(proxy.exec(escrowAddr, enc(escrow, "fund", [id]))).to.changeTokenBalances(
      token,
      [proxy, escrow],
      [-E(200), E(200)],
    );
    expect(await proxy.hookSuccess()).to.equal(false);
    expect(await proxy.hookReturn()).to.equal(REENTRANCY_SELECTOR);
    expect(await escrow.totalHeld()).to.equal(E(200));
    await assertInvariants(escrow, token);
  });

  it("re-entering settlement acceptance during the split payout is blocked", async () => {
    const { escrow, token, client, proxy, escrowAddr } = await reentrantSetup();
    const proxyAddr = await proxy.getAddress();
    const id = await createProject(escrow, client, { freelancer: proxyAddr });
    const p = await escrow.getProject(id);
    await proxy.exec(escrowAddr, enc(escrow, "acceptTerms", [id, p.termsHash, p.termsVersion]));
    await token.connect(client).approve(escrowAddr, E(200));
    await escrow.connect(client).fund(id);
    await escrow.connect(client).openDispute(id, 0, REASON);
    await escrow.connect(client).proposeSettlement(id, 0, E(15));

    await proxy.setHook(escrowAddr, enc(escrow, "acceptSettlement", [id, 0, E(15)]));
    await token.arm(proxyAddr, proxy.interface.encodeFunctionData("hook"));
    await expect(proxy.exec(escrowAddr, enc(escrow, "acceptSettlement", [id, 0, E(15)]))).to.changeTokenBalances(
      token,
      [proxy, client],
      [E(15), E(25)],
    );
    expect(await proxy.hookSuccess()).to.equal(false);
    expect(await proxy.hookReturn()).to.equal(REENTRANCY_SELECTOR);
    await assertInvariants(escrow, token);
  });

  it("checks-effects-interactions: an unguarded call made mid-transfer already sees settled state", async () => {
    const { escrow, token, client, proxy, escrowAddr } = await reentrantSetup();
    const proxyAddr = await proxy.getAddress();
    const id = await createProject(escrow, client, { freelancer: proxyAddr, autoRelease: true });
    const p = await escrow.getProject(id);
    await proxy.exec(escrowAddr, enc(escrow, "acceptTerms", [id, p.termsHash, p.termsVersion]));
    await token.connect(client).approve(escrowAddr, E(200));
    await escrow.connect(client).fund(id);
    await proxy.exec(escrowAddr, enc(escrow, "submitMilestone", [id, 0, SUB(1)]));

    // During the release transfer the freelancer contract tries to resubmit the milestone being paid.
    await proxy.setHook(escrowAddr, enc(escrow, "submitMilestone", [id, 0, SUB(9)]));
    await token.arm(proxyAddr, proxy.interface.encodeFunctionData("hook"));
    await escrow.connect(client).approveAndRelease(id, 0);
    expect(await proxy.hookSuccess()).to.equal(false); // milestone already Released when the hook ran
    const ret = await proxy.hookReturn();
    const decoded = escrow.interface.parseError(ret);
    expect(decoded?.name).to.equal("InvalidMilestoneStatus");
    expect(decoded?.args[0]).to.equal(MS.Released);
    await assertInvariants(escrow, token);
  });
});
