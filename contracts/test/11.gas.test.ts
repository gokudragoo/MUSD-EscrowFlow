import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { ContractTransactionResponse } from "ethers";
import { baseFixture, createProject, acceptCurrent, activeProject, E, DAY, SUB, REASON, Ctx } from "./helpers";

/**
 * Gas used (receipts, 4-milestone projects, MockSavingsVault) with sMUSD yield off vs on, so the
 * app can set gas floors. "on" runs in steady state: another yield project is parked and the
 * vault has unharvested yield, so every vault call also harvests/credits yield. The first-ever
 * yield deposit of a registry is measured separately (cold vault + escrow totals).
 * NOTE: the real MUSDSavingsRate costs more than the mock per vault call (proxy, PCV distribution,
 * strategy allocate/deallocate); see the report for the mainnet-fork figures.
 */
describe("EscrowFlow · gas (yield off vs on)", () => {
  const rows: Record<string, { off?: bigint; on?: bigint }> = {};
  const used = async (tx: Promise<ContractTransactionResponse>) => (await (await tx).wait())!.gasUsed;
  const record = (name: string, mode: "off" | "on", gas: bigint) => {
    rows[name] ??= {};
    rows[name][mode] = gas;
  };

  async function signPermit(ctx: Ctx, value: bigint) {
    const { musd, client, escrow } = ctx;
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
        { owner: client.address, spender: await escrow.getAddress(), value, nonce: await musd.nonces(client.address), deadline },
      ),
    );
    return { deadline, sig };
  }

  for (const mode of ["off", "on"] as const) {
    it(`measures every money-moving call with yield ${mode}`, async () => {
      const ctx = await loadFixture(baseFixture);
      const { escrow, musd, vault, deployer, client, freelancer, arbiter, client2, freelancer2 } = ctx;
      const y = { yieldEnabled: mode === "on", freelancerYieldBps: mode === "on" ? 5000 : 0 };
      const opts = { ...y, arbiter: arbiter.address, autoRelease: true, deadlineReclaim: true };
      const escrowAddr = await escrow.getAddress();
      const inject = () => vault.connect(deployer).receiveProtocolYield(E(1));

      // first-ever deposit into the vault for this registry
      const first = await createProject(escrow, client2, { freelancer: freelancer2.address, ...y });
      await acceptCurrent(escrow, freelancer2, first);
      await musd.connect(client2).approve(escrowAddr, E(200));
      record("fund (first yield deposit of the registry)", mode, await used(escrow.connect(client2).fund(first)));
      await inject();

      // createProject
      const params = await (await import("./helpers")).makeParams({ freelancer: freelancer.address, ...opts });
      record("createProject (4 milestones)", mode, await used(escrow.connect(client).createProject(params)));
      const a = (await escrow.ID_OFFSET()) + (await escrow.projectCount());
      await acceptCurrent(escrow, freelancer, a);
      await musd.connect(client).approve(escrowAddr, E(200));
      record("fund", mode, await used(escrow.connect(client).fund(a)));
      await inject();

      // fundWithPermit
      const b = await createProject(escrow, client, { freelancer: freelancer.address, ...opts });
      await acceptCurrent(escrow, freelancer, b);
      const { deadline, sig } = await signPermit(ctx, E(200));
      record("fundWithPermit", mode, await used(escrow.connect(client).fundWithPermit(b, deadline, sig.v, sig.r, sig.s)));
      await inject();

      // approveAndRelease
      await escrow.connect(freelancer).submitMilestone(a, 0, SUB(1));
      record("approveAndRelease", mode, await used(escrow.connect(client).approveAndRelease(a, 0)));
      await inject();

      // claimAfterReviewTimeout
      await escrow.connect(freelancer).submitMilestone(a, 1, SUB(2));
      await time.increase(3 * DAY);
      record("claimAfterReviewTimeout", mode, await used(escrow.connect(freelancer).claimAfterReviewTimeout(a, 1)));
      await inject();

      // acceptSettlement / arbiterResolve (split payout)
      await escrow.connect(freelancer).submitMilestone(a, 2, SUB(3));
      await escrow.connect(client).openDispute(a, 2, REASON);
      await escrow.connect(client).proposeSettlement(a, 2, E(20));
      record("acceptSettlement (split)", mode, await used(escrow.connect(freelancer).acceptSettlement(a, 2, E(20))));
      await inject();
      await escrow.connect(client).openDispute(b, 0, REASON);
      record("withdrawDispute", mode, await used(escrow.connect(client).withdrawDispute(b, 0)));
      await escrow.connect(client).openDispute(b, 0, REASON);
      record("arbiterResolve (split)", mode, await used(escrow.connect(arbiter).arbiterResolve(b, 0, E(15))));
      await inject();

      // reclaimExpiredMilestone
      await time.increase(365 * DAY);
      record("reclaimExpiredMilestone", mode, await used(escrow.connect(client).reclaimExpiredMilestone(a, 3)));
      await inject();

      // acceptCancellation: 4 pending milestones refunded in one go
      const c = await activeProject(escrow, musd, client, freelancer, { ...y, amounts: [E(40), E(60), E(60), E(40)] });
      await inject();
      await escrow.connect(client).proposeCancellation(c);
      record("acceptCancellation (4 milestones refunded)", mode, await used(escrow.connect(freelancer).acceptCancellation(c, E(200))));
      await inject();

      if (mode === "on") {
        record("distributeYield (both shares > 0)", mode, await used(escrow.connect(client).distributeYield(b)));
        await inject();
        record("distributeYield (after completion/cancel)", mode, await used(escrow.connect(client).distributeYield(c)));
      }
      for (const r of Object.values(rows)) if (r[mode] !== undefined) expect(r[mode]!).to.be.lt(1_000_000n);
    });
  }

  after(() => {
    const pad = (s: string, n: number) => s.padEnd(n);
    const lines = [
      `      ${pad("function", 44)} ${pad("yield off", 10)} ${pad("yield on", 10)} delta`,
      ...Object.entries(rows).map(([k, v]) => {
        const off = v.off !== undefined ? v.off.toString() : "-";
        const on = v.on !== undefined ? v.on.toString() : "-";
        const delta = v.off !== undefined && v.on !== undefined ? `+${(v.on - v.off).toString()}` : "";
        return `      ${pad(k, 44)} ${pad(off, 10)} ${pad(on, 10)} ${delta}`;
      }),
    ];
    console.log(lines.join("\n"));
  });
});
