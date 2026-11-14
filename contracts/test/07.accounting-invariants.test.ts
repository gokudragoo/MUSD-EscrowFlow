import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { ContractTransactionResponse, ContractTransactionReceipt } from "ethers";
import {
  baseFixture,
  makeParams,
  createProject,
  acceptCurrent,
  fundProject,
  activeProject,
  assertInvariants,
  cancellationRefund,
  vaultPending,
  lastId,
  allIds,
  prng,
  PS,
  MS,
  E,
  DAY,
  HOUR,
  SUB,
  REASON,
  Signer,
} from "./helpers";

describe("EscrowFlow · escrow accounting (spec §26 scenario + concurrent projects)", () => {
  it("Alice/Bob 200 MUSD (40/60/60/40): release M1, dispute+split M2, cancel M3+M4 — invariants after every step", async () => {
    const { escrow, musd, client: alice, freelancer: bob, stranger, client2, freelancer2, arbiter } =
      await loadFixture(baseFixture);
    const inv = () => assertInvariants(escrow, musd);
    const aliceStart = await musd.balanceOf(alice.address);
    const bobStart = await musd.balanceOf(bob.address);

    // 1-3. Alice creates the project for Bob with four milestones.
    const id = await createProject(escrow, alice, { freelancer: bob.address });
    expect((await escrow.getProject(id)).totalAmount).to.equal(E(200));
    await inv();
    // 4-5. Bob accepts the terms.
    await acceptCurrent(escrow, bob, id);
    await inv();
    // 6-7. Alice funds 200 MUSD; the contract verifies receipt of the exact amount.
    await expect(fundProject(escrow, musd, alice, id)).to.emit(escrow, "ProjectFunded").withArgs(id, alice.address, E(200));
    expect(await musd.balanceOf(await escrow.getAddress())).to.equal(E(200));
    await inv();

    // A second, unrelated project runs concurrently (with an arbiter).
    const id2 = await activeProject(escrow, musd, client2, freelancer2, {
      amounts: [E(30), E(70)],
      arbiter: arbiter.address,
    });
    await inv();

    // 8-12. Bob submits M1, Alice approves and releases 40 MUSD to Bob.
    await escrow.connect(bob).submitMilestone(id, 0, SUB(1));
    await inv();
    await expect(escrow.connect(alice).approveAndRelease(id, 0)).to.changeTokenBalances(musd, [bob], [E(40)]);
    await inv();
    // 13. 40 released / 160 remaining in escrow.
    let p = await escrow.getProject(id);
    expect(p.releasedAmount).to.equal(E(40));
    expect(await escrow.heldAmount(id)).to.equal(E(160));
    // 15. Unauthorised release attempt is rejected.
    await escrow.connect(bob).submitMilestone(id, 1, SUB(2));
    await expect(escrow.connect(stranger).approveAndRelease(id, 1)).to.be.revertedWithCustomError(escrow, "NotClient");
    await inv();

    // Dispute path on M2: changes requested, Bob disputes, Alice proposes 30/30, Bob accepts.
    await escrow.connect(alice).requestChanges(id, 1, REASON);
    await inv();
    await escrow.connect(bob).openDispute(id, 1, REASON);
    await inv();
    await escrow.connect(alice).proposeSettlement(id, 1, E(30));
    await expect(escrow.connect(bob).acceptSettlement(id, 1, E(30))).to.changeTokenBalances(
      musd,
      [bob, alice],
      [E(30), E(30)],
    );
    await inv();

    // Concurrent project: client disputes, arbiter rules 20/10.
    await escrow.connect(freelancer2).submitMilestone(id2, 0, SUB(21));
    await escrow.connect(client2).openDispute(id2, 0, REASON);
    await inv();
    await escrow.connect(arbiter).arbiterResolve(id2, 0, E(20));
    await inv();

    // Cancellation path on M3 + M4: Alice proposes, Bob accepts → 100 MUSD back to Alice.
    await escrow.connect(alice).proposeCancellation(id);
    await expect(escrow.connect(bob).acceptCancellation(id, E(100))).to.changeTokenBalances(musd, [alice, bob], [E(100), 0n]);
    await inv();
    p = await escrow.getProject(id);
    expect(p.status).to.equal(PS.Cancelled);
    expect(p.releasedAmount).to.equal(E(70));
    expect(p.refundedAmount).to.equal(E(130));
    expect(await escrow.heldAmount(id)).to.equal(0n);
    expect(p.fundedAmount).to.equal(p.releasedAmount + p.refundedAmount);

    // Net effect: Alice paid 70, Bob earned 70 — nothing created or lost.
    expect(await musd.balanceOf(alice.address)).to.equal(aliceStart - E(70));
    expect(await musd.balanceOf(bob.address)).to.equal(bobStart + E(70));

    // Finish the concurrent project.
    await escrow.connect(freelancer2).submitMilestone(id2, 1, SUB(22));
    await escrow.connect(client2).approveAndRelease(id2, 1);
    await inv();
    expect((await escrow.getProject(id2)).status).to.equal(PS.Completed);
    expect(await escrow.totalHeld()).to.equal(0n);
    expect(await musd.balanceOf(await escrow.getAddress())).to.equal(0n);
  });

  it("same scenario with sMUSD yield on one project and yield injections: invariants after every step", async () => {
    const { escrow, musd, vault, deployer, client: alice, freelancer: bob, client2, freelancer2, arbiter } =
      await loadFixture(baseFixture);
    const inv = () => assertInvariants(escrow, musd);
    const escrowAddr = await escrow.getAddress();
    const inject = async (amt: bigint) => {
      await vault.connect(deployer).receiveProtocolYield(amt);
      await inv();
    };

    const id = await activeProject(escrow, musd, alice, bob, { yieldEnabled: true, freelancerYieldBps: 3000 });
    expect(await musd.balanceOf(escrowAddr)).to.equal(0n);
    expect(await vault.balanceOf(escrowAddr)).to.equal(E(200));
    await inv();
    const id2 = await activeProject(escrow, musd, client2, freelancer2, { amounts: [E(30), E(70)], arbiter: arbiter.address });
    expect(await musd.balanceOf(escrowAddr)).to.equal(E(100));
    await inject(E(2));

    await escrow.connect(bob).submitMilestone(id, 0, SUB(1));
    await expect(escrow.connect(alice).approveAndRelease(id, 0)).to.changeTokenBalances(musd, [bob], [E(40)]);
    await inv();
    await inject(E(1));
    await escrow.connect(bob).submitMilestone(id, 1, SUB(2));
    await escrow.connect(alice).requestChanges(id, 1, REASON);
    await escrow.connect(bob).openDispute(id, 1, REASON);
    await escrow.connect(alice).proposeSettlement(id, 1, E(30));
    await expect(escrow.connect(bob).acceptSettlement(id, 1, E(30))).to.changeTokenBalances(musd, [bob, alice], [E(30), E(30)]);
    await inv();
    await escrow.connect(freelancer2).submitMilestone(id2, 0, SUB(21));
    await escrow.connect(client2).openDispute(id2, 0, REASON);
    await escrow.connect(arbiter).arbiterResolve(id2, 0, E(20));
    await inv();
    await inject(E(1));
    await escrow.connect(alice).proposeCancellation(id);
    await expect(escrow.connect(bob).acceptCancellation(id, E(100))).to.changeTokenBalances(musd, [alice, bob], [E(100), 0n]);
    await inv();
    expect((await escrow.getProject(id)).status).to.equal(PS.Cancelled);
    expect(await vault.balanceOf(escrowAddr)).to.equal(0n);

    // All 4 MUSD of yield belonged to the only yield project; distribute it after cancellation.
    const y = await escrow.getYield(id);
    expect(y.accrued).to.be.closeTo(E(4), 10n);
    await expect(escrow.connect(alice).distributeYield(id)).to.changeTokenBalances(
      musd,
      [bob, alice],
      [(y.accrued * 3000n) / 10_000n, y.accrued - (y.accrued * 3000n) / 10_000n],
    );
    await inv();
    await escrow.connect(freelancer2).submitMilestone(id2, 1, SUB(22));
    await escrow.connect(client2).approveAndRelease(id2, 1);
    await inv();
    expect(await escrow.totalHeld()).to.equal(0n);
    expect(await musd.balanceOf(escrowAddr)).to.be.lt(100n); // rounding dust only
  });

  it("stray token donations to the contract never enter project accounting and cannot be withdrawn", async () => {
    const { escrow, musd, client, freelancer, stranger } = await loadFixture(baseFixture);
    const id = await activeProject(escrow, musd, client, freelancer, { amounts: [E(10), E(10)] });
    await musd.connect(stranger).transfer(await escrow.getAddress(), E(5));
    await assertInvariants(escrow, musd);
    expect(await escrow.totalHeld()).to.equal(E(20));
    expect(await escrow.heldAmount(id)).to.equal(E(20));
    await escrow.connect(client).proposeCancellation(id);
    await expect(escrow.connect(freelancer).acceptCancellation(id, E(20))).to.changeTokenBalances(musd, [client], [E(20)]);
    await assertInvariants(escrow, musd);
    expect(await escrow.totalHeld()).to.equal(0n);
    expect(await musd.balanceOf(await escrow.getAddress())).to.equal(E(5)); // stuck donation, not anyone's escrow
  });

  it("a milestone is paid at most once across every payout path (release / claim / reclaim / settle / cancel)", async () => {
    const { escrow, musd, client, freelancer, arbiter } = await loadFixture(baseFixture);
    const id = await activeProject(escrow, musd, client, freelancer, {
      amounts: [E(1), E(2), E(3), E(4), E(5)],
      autoRelease: true,
      deadlineReclaim: true,
      arbiter: arbiter.address,
    });
    await escrow.connect(freelancer).submitMilestone(id, 0, SUB(0));
    await escrow.connect(client).approveAndRelease(id, 0); // released
    await escrow.connect(freelancer).submitMilestone(id, 1, SUB(1));
    await escrow.connect(client).openDispute(id, 1, REASON);
    await escrow.connect(arbiter).arbiterResolve(id, 1, E(1)); // resolved
    await escrow.connect(freelancer).submitMilestone(id, 2, SUB(2));
    await time.increase(4 * DAY);
    await escrow.connect(freelancer).claimAfterReviewTimeout(id, 2); // released by timeout
    await time.increase(365 * DAY);
    await escrow.connect(client).reclaimExpiredMilestone(id, 3); // refunded
    await escrow.connect(client).proposeCancellation(id);
    await escrow.connect(freelancer).acceptCancellation(id, E(5)); // M5 refunded, project closes

    const payouts = [
      () => escrow.connect(client).approveAndRelease(id, 0),
      () => escrow.connect(freelancer).claimAfterReviewTimeout(id, 2),
      () => escrow.connect(client).reclaimExpiredMilestone(id, 3),
      () => escrow.connect(arbiter).arbiterResolve(id, 1, 0),
      () => escrow.connect(client).acceptCancellation(id, 0),
    ];
    for (const tx of payouts) await expect(tx()).to.be.reverted;
    const p = await escrow.getProject(id);
    expect(p.status).to.equal(PS.Cancelled);
    expect(p.releasedAmount).to.equal(E(1) + E(1) + E(3));
    expect(p.refundedAmount).to.equal(E(1) + E(4) + E(5));
    await assertInvariants(escrow, musd);
  });
});

describe("EscrowFlow · randomized action sequences (seeded fuzz, plain + sMUSD yield projects)", () => {
  type Action =
    | "advance"
    | "submit"
    | "requestChanges"
    | "approve"
    | "claim"
    | "reclaim"
    | "disputeClient"
    | "disputeFreelancer"
    | "propose"
    | "accept"
    | "arbiter"
    | "withdraw"
    | "proposeCancel"
    | "acceptCancel"
    | "revokeCancel"
    | "stranger"
    | "injectYield"
    | "distributeYield";

  const ACTIONS: Action[] = [
    "advance",
    "submit",
    "submit",
    "requestChanges",
    "approve",
    "claim",
    "reclaim",
    "disputeClient",
    "disputeFreelancer",
    "propose",
    "accept",
    "accept",
    "arbiter",
    "withdraw",
    "proposeCancel",
    "acceptCancel",
    "revokeCancel",
    "stranger",
    "injectYield",
    "distributeYield",
  ];

  for (const seed of [0xe5c0, 0xbeef, 0x2026]) {
    it(`seed 0x${seed.toString(16)}: 200 random actions across 3 concurrent projects keep every invariant`, async () => {
      const { escrow, musd, vault, deployer, client, freelancer, arbiter, stranger } = await loadFixture(baseFixture);
      const escrowAddr = await escrow.getAddress();
      const rnd = prng(seed);
      const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
      const bal = async (s: Signer) => musd.balanceOf(s.address);
      const start = {
        client: await bal(client),
        freelancer: await bal(freelancer),
        arbiter: await bal(arbiter),
        stranger: await bal(stranger),
      };
      let injected = 0n;
      let yieldToClient = 0n;
      let yieldToFreelancer = 0n;
      const recordYield = (rc: ContractTransactionReceipt | null) => {
        for (const log of rc?.logs ?? []) {
          if (log.address !== escrowAddr) continue;
          const ev = escrow.interface.parseLog(log);
          if (ev?.name === "YieldDistributed") {
            yieldToFreelancer += ev.args.freelancerAmount as bigint;
            yieldToClient += ev.args.clientAmount as bigint;
          }
        }
      };

      async function newProject(): Promise<bigint> {
        const n = 1 + Math.floor(rnd() * 5);
        const now = BigInt(await time.latest());
        const amounts = Array.from({ length: n }, () => E(1 + Math.floor(rnd() * 100)) + BigInt(Math.floor(rnd() * 1e6)));
        const deadlines = amounts.map(() => now + BigInt(HOUR + Math.floor(rnd() * 20 * DAY)));
        const reviewPeriods = amounts.map(() => 60 + Math.floor(rnd() * 4 * DAY));
        const yieldEnabled = rnd() < 0.5;
        const bps = Math.floor(rnd() * 10_001);
        const params = await makeParams({
          freelancer: freelancer.address,
          arbiter: rnd() < 0.6 ? arbiter.address : ethers.ZeroAddress,
          autoRelease: rnd() < 0.6,
          deadlineReclaim: rnd() < 0.6,
          reclaimGracePeriod: 60 + Math.floor(rnd() * 3 * DAY),
          amounts,
          deadlines,
          reviewPeriods,
          yieldEnabled,
          freelancerYieldBps: yieldEnabled ? pick([0, 10_000, bps, bps]) : 0,
        });
        await escrow.connect(client).createProject(params);
        const id = await lastId(escrow);
        await acceptCurrent(escrow, freelancer, id);
        await fundProject(escrow, musd, client, id);
        return id;
      }

      const slots: bigint[] = [await newProject(), await newProject(), await newProject()];
      const tally: Record<string, { ok: number; reverted: number }> = {};
      let ok = 0;

      for (let step = 0; step < 200; step++) {
        const slot = Math.floor(rnd() * slots.length);
        let id = slots[slot];
        let p = await escrow.getProject(id);
        if (p.status !== PS.Active) {
          if ((await escrow.projectCount()) < 25n) {
            id = slots[slot] = await newProject();
            p = await escrow.getProject(id);
          } else continue;
        }
        const i = Math.floor(rnd() * Number(p.milestoneCount));
        const m = await escrow.getMilestone(id, i);
        const party = rnd() < 0.5 ? client : freelancer;
        // 80 %: an action relevant to the milestone's current status; 20 %: anything (exercises reverts).
        let relevant: Action[];
        switch (m.status) {
          case MS.Pending:
            relevant = ["submit", "submit", "disputeClient", "disputeFreelancer", "reclaim", "advance"];
            break;
          case MS.Submitted:
            relevant = ["approve", "requestChanges", "claim", "disputeClient", "disputeFreelancer", "advance"];
            break;
          case MS.ChangesRequested:
            relevant = ["submit", "approve", "reclaim", "disputeFreelancer", "advance"];
            break;
          case MS.Disputed:
            relevant = ["propose", "accept", "accept", "arbiter", "withdraw"];
            break;
          default:
            relevant = ["proposeCancel", "revokeCancel", "advance", "stranger"];
        }
        if (p.cancelProposer !== ethers.ZeroAddress) relevant.push("acceptCancel", "revokeCancel");
        relevant.push("injectYield", "distributeYield");
        const action = rnd() < 0.8 ? pick(relevant) : pick(ACTIONS);
        let tx: Promise<ContractTransactionResponse> | null = null;
        let onOk: ((rc: ContractTransactionReceipt | null) => void) | null = null;

        switch (action) {
          case "advance":
            await time.increase(1 + Math.floor(rnd() * 3 * DAY));
            break;
          case "submit":
            tx = escrow.connect(freelancer).submitMilestone(id, i, SUB(step + 1));
            break;
          case "requestChanges":
            tx = escrow.connect(client).requestChanges(id, i, REASON);
            break;
          case "approve":
            tx = escrow.connect(client).approveAndRelease(id, i);
            break;
          case "claim":
            tx = escrow.connect(freelancer).claimAfterReviewTimeout(id, i);
            break;
          case "reclaim":
            tx = escrow.connect(client).reclaimExpiredMilestone(id, i);
            break;
          case "disputeClient":
            tx = escrow.connect(client).openDispute(id, i, REASON);
            break;
          case "disputeFreelancer":
            tx = escrow.connect(freelancer).openDispute(id, i, REASON);
            break;
          case "propose": {
            // occasionally propose more than the milestone (must revert)
            const amt = rnd() < 0.1 ? m.amount + 1n : (m.amount * BigInt(Math.floor(rnd() * 101))) / 100n;
            tx = escrow.connect(party).proposeSettlement(id, i, amt);
            break;
          }
          case "accept": {
            const counter = m.settlementProposer === client.address ? freelancer : client;
            const amt = rnd() < 0.15 ? m.proposedFreelancerAmount + 1n : m.proposedFreelancerAmount;
            tx = escrow.connect(counter).acceptSettlement(id, i, amt);
            break;
          }
          case "arbiter":
            tx = escrow.connect(arbiter).arbiterResolve(id, i, (m.amount * BigInt(Math.floor(rnd() * 101))) / 100n);
            break;
          case "withdraw":
            tx = escrow.connect(party).withdrawDispute(id, i);
            break;
          case "proposeCancel":
            if (rnd() < 0.5) tx = escrow.connect(party).proposeCancellation(id); // keep cancellations rarer
            break;
          case "acceptCancel": {
            const counter = p.cancelProposer === client.address ? freelancer : client;
            // occasionally the acceptor's expectation is stale (must revert RefundMismatch)
            const expected = (await cancellationRefund(escrow, id)) + (rnd() < 0.1 ? 1n : 0n);
            tx = escrow.connect(counter).acceptCancellation(id, expected);
            break;
          }
          case "revokeCancel":
            tx = escrow.connect(party).revokeCancellation(id);
            break;
          case "injectYield": {
            // Protocol yield to sMUSD holders: paid now, or queued for the vault's next deposit/withdraw (PCV).
            const amt = E(Math.floor(rnd() * 5)) + BigInt(1 + Math.floor(rnd() * 1e9));
            tx = rnd() < 0.7
              ? vault.connect(deployer).receiveProtocolYield(amt)
              : vault.connect(deployer).queueProtocolYield(amt);
            onOk = () => {
              injected += amt;
            };
            break;
          }
          case "distributeYield":
            tx = escrow.connect(party).distributeYield(id);
            onOk = recordYield;
            break;
          case "stranger": {
            const attempts = [
              () => escrow.connect(stranger).approveAndRelease(id, i),
              () => escrow.connect(stranger).claimAfterReviewTimeout(id, i),
              () => escrow.connect(stranger).reclaimExpiredMilestone(id, i),
              () => escrow.connect(stranger).acceptSettlement(id, i, m.proposedFreelancerAmount),
              () => escrow.connect(stranger).arbiterResolve(id, i, 0),
              () => escrow.connect(stranger).acceptCancellation(id, 0),
              () => escrow.connect(stranger).distributeYield(id),
            ];
            for (const a of attempts) await expect(a()).to.be.reverted;
            break;
          }
        }

        tally[action] ??= { ok: 0, reverted: 0 };
        if (tx) {
          try {
            const rc = await (await tx).wait();
            onOk?.(rc);
            tally[action].ok++;
            ok++;
          } catch {
            tally[action].reverted++;
          }
        }
        await assertInvariants(escrow, musd);
      }

      // Yield earned while funds were held belongs to the parties: distribute what is left,
      // including on completed / cancelled projects.
      for (const id of await allIds(escrow)) {
        const y = await escrow.getYield(id);
        if (y.enabled && y.accrued > 0n) recordYield(await (await escrow.connect(client).distributeYield(id)).wait());
      }
      await assertInvariants(escrow, musd);

      // Conservation of value across the whole run.
      let funded = 0n;
      let released = 0n;
      let refunded = 0n;
      let yieldProjects = 0;
      for (const id of await allIds(escrow)) {
        const p = await escrow.getProject(id);
        funded += p.fundedAmount;
        released += p.releasedAmount;
        refunded += p.refundedAmount;
        if ((await escrow.getYield(id)).enabled) yieldProjects++;
      }
      expect(await bal(client)).to.equal(start.client - funded + refunded + yieldToClient);
      expect(await bal(freelancer)).to.equal(start.freelancer + released + yieldToFreelancer);
      expect(await bal(arbiter)).to.equal(start.arbiter);
      expect(await bal(stranger)).to.equal(start.stranger);
      const held = funded - released - refunded;
      expect(await escrow.totalHeld()).to.equal(held);
      const parked = await escrow.totalYieldPrincipal();
      expect(await vault.balanceOf(escrowAddr)).to.equal(parked);
      // Every injected wei of yield is paid to a party, sitting in the escrow (rounding dust /
      // unattributed), or still owed by the vault — up to the vault's own index rounding.
      const escrowSurplus = (await musd.balanceOf(escrowAddr)) - (held - parked);
      const vaultLeft =
        (await vaultPending(vault, escrowAddr)) + (await vault.pendingYield()) + (await vault.queuedProtocolYield());
      const unexplained = injected - (yieldToClient + yieldToFreelancer + escrowSurplus + vaultLeft);
      expect(unexplained >= 0n && unexplained < 10n ** 7n, `unexplained yield ${unexplained}`).to.equal(true);
      // The sequence must actually exercise the state machine, not just revert.
      expect(ok, JSON.stringify(tally)).to.be.greaterThan(50);
      expect(released > 0n && refunded > 0n).to.equal(true);
      expect(yieldProjects > 0 && yieldToClient + yieldToFreelancer > 0n, JSON.stringify(tally)).to.equal(true);
      console.log(
        `      seed 0x${seed.toString(16)}: ${ok} successful state transitions, ${await escrow.projectCount()} projects ` +
          `(${yieldProjects} with yield), ${ethers.formatUnits(yieldToClient + yieldToFreelancer, 18)} MUSD yield distributed`,
      );
    });
  }
});
