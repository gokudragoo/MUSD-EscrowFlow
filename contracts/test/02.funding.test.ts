import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  baseFixture,
  deployWithToken,
  createProject,
  acceptCurrent,
  fundProject,
  activeProject,
  assertInvariants,
  PS,
  E,
  DAY,
  Signer,
} from "./helpers";
import type { MockMUSD, EscrowFlow } from "../typechain-types";

async function signPermit(token: MockMUSD, owner: Signer, spender: string, value: bigint, deadline: bigint, signer = owner) {
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "Mezo USD", version: "1", chainId, verifyingContract: await token.getAddress() };
  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const nonce = await token.nonces(owner.address);
  const sig = await signer.signTypedData(domain, types, { owner: owner.address, spender, value, nonce, deadline });
  return ethers.Signature.from(sig);
}

async function acceptedProject() {
  const ctx = await loadFixture(baseFixture);
  const id = await createProject(ctx.escrow, ctx.client, { freelancer: ctx.freelancer.address });
  await acceptCurrent(ctx.escrow, ctx.freelancer, id);
  return { ...ctx, id };
}

describe("EscrowFlow · funding", () => {
  describe("correct funding", () => {
    it("pulls exactly the total, emits ProjectFunded and activates the project", async () => {
      const { escrow, musd, client, id } = await acceptedProject();
      await musd.connect(client).approve(await escrow.getAddress(), E(200));
      const tx = escrow.connect(client).fund(id);
      await expect(tx).to.emit(escrow, "ProjectFunded").withArgs(id, client.address, E(200));
      await expect(tx).to.changeTokenBalances(musd, [client, escrow], [-E(200), E(200)]);
      const p = await escrow.getProject(id);
      expect(p.status).to.equal(PS.Active);
      expect(p.fundedAmount).to.equal(E(200));
      expect(p.fundedAt).to.equal(BigInt(await time.latest()));
      expect(await escrow.heldAmount(id)).to.equal(E(200));
      expect(await escrow.totalHeld()).to.equal(E(200));
      await assertInvariants(escrow, musd);
    });

    it("only pulls the total even with an unlimited allowance", async () => {
      const { escrow, musd, client, id } = await acceptedProject();
      await musd.connect(client).approve(await escrow.getAddress(), ethers.MaxUint256);
      await expect(escrow.connect(client).fund(id)).to.changeTokenBalances(musd, [client, escrow], [-E(200), E(200)]);
    });

    it("tracks totalHeld across several funded projects", async () => {
      const { escrow, musd, client, client2, freelancer, freelancer2 } = await loadFixture(baseFixture);
      await activeProject(escrow, musd, client, freelancer);
      await activeProject(escrow, musd, client2, freelancer2, { amounts: [E(3), E(4)] });
      expect(await escrow.totalHeld()).to.equal(E(207));
      expect(await musd.balanceOf(await escrow.getAddress())).to.equal(E(207));
      await assertInvariants(escrow, musd);
    });
  });

  describe("insufficient / invalid funding", () => {
    it("reverts without allowance and leaves the project unfunded", async () => {
      const { escrow, musd, client, id } = await acceptedProject();
      await expect(escrow.connect(client).fund(id)).to.be.revertedWithCustomError(musd, "ERC20InsufficientAllowance");
      const p = await escrow.getProject(id);
      expect(p.status).to.equal(PS.AwaitingFunding);
      expect(p.fundedAmount).to.equal(0n);
      expect(await escrow.totalHeld()).to.equal(0n);
    });

    it("reverts with an allowance 1 wei short of the total", async () => {
      const { escrow, musd, client, id } = await acceptedProject();
      await musd.connect(client).approve(await escrow.getAddress(), E(200) - 1n);
      await expect(escrow.connect(client).fund(id)).to.be.revertedWithCustomError(musd, "ERC20InsufficientAllowance");
    });

    it("reverts when the client's balance is below the total (insufficient funding)", async () => {
      const { escrow, musd, broke, freelancer } = await loadFixture(baseFixture);
      await musd.mint(broke.address, E(199));
      const id = await createProject(escrow, broke, { freelancer: freelancer.address });
      await acceptCurrent(escrow, freelancer, id);
      await musd.connect(broke).approve(await escrow.getAddress(), E(200));
      await expect(escrow.connect(broke).fund(id)).to.be.revertedWithCustomError(musd, "ERC20InsufficientBalance");
      expect((await escrow.getProject(id)).status).to.equal(PS.AwaitingFunding);
      expect(await musd.balanceOf(broke.address)).to.equal(E(199));
    });

    it("cannot fund before the freelancer accepted", async () => {
      const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
      const id = await createProject(escrow, client, { freelancer: freelancer.address });
      await musd.connect(client).approve(await escrow.getAddress(), E(200));
      await expect(escrow.connect(client).fund(id))
        .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
        .withArgs(PS.AwaitingAcceptance);
    });

    it("only the client can fund", async () => {
      const { escrow, musd, freelancer, stranger, id } = await acceptedProject();
      for (const s of [freelancer, stranger]) {
        await musd.connect(s).approve(await escrow.getAddress(), E(200));
        await expect(escrow.connect(s).fund(id)).to.be.revertedWithCustomError(escrow, "NotClient");
      }
    });

    it("cannot fund twice", async () => {
      const { escrow, musd, client, id } = await acceptedProject();
      await musd.connect(client).approve(await escrow.getAddress(), E(400));
      await escrow.connect(client).fund(id);
      await expect(escrow.connect(client).fund(id))
        .to.be.revertedWithCustomError(escrow, "InvalidProjectStatus")
        .withArgs(PS.Active);
      expect(await escrow.totalHeld()).to.equal(E(200));
    });

    it("cannot fund an unknown project", async () => {
      const { escrow, client } = await loadFixture(baseFixture);
      await expect(escrow.connect(client).fund(42n)).to.be.revertedWithCustomError(escrow, "ProjectNotFound").withArgs(42n);
    });

    it("reverts DeadlinePassed(index) if any milestone deadline already passed", async () => {
      const { escrow, musd, client, freelancer } = await loadFixture(baseFixture);
      const now = BigInt(await time.latest());
      const id = await createProject(escrow, client, {
        freelancer: freelancer.address,
        amounts: [E(1), E(1), E(1)],
        deadlines: [now + BigInt(10 * DAY), now + BigInt(2 * DAY), now + BigInt(20 * DAY)],
      });
      await acceptCurrent(escrow, freelancer, id);
      await time.increase(3 * DAY);
      await musd.connect(client).approve(await escrow.getAddress(), E(3));
      await expect(escrow.connect(client).fund(id)).to.be.revertedWithCustomError(escrow, "DeadlinePassed").withArgs(1n);
    });

    it("fee-on-transfer token: funding reverts FundingShortfall(expected, received) and nothing is recorded", async () => {
      const { escrow, token, client, freelancer } = await deployWithToken("FeeOnTransferToken", [100]); // 1 %
      const id = await createProject(escrow as EscrowFlow, client, { freelancer: freelancer.address });
      await acceptCurrent(escrow, freelancer, id);
      await token.connect(client).approve(await escrow.getAddress(), E(200));
      await expect(escrow.connect(client).fund(id))
        .to.be.revertedWithCustomError(escrow, "FundingShortfall")
        .withArgs(E(200), E(198));
      const p = await escrow.getProject(id);
      expect(p.status).to.equal(PS.AwaitingFunding);
      expect(p.fundedAmount).to.equal(0n);
      expect(await escrow.totalHeld()).to.equal(0n);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
      // With the fee switched off the same project funds normally.
      await token.setFeeBps(0);
      await expect(escrow.connect(client).fund(id)).to.emit(escrow, "ProjectFunded");
    });
  });

  describe("fundWithPermit (EIP-2612)", () => {
    it("funds in a single transaction with a valid permit signature", async () => {
      const { escrow, musd, client, id } = await acceptedProject();
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(musd, client, await escrow.getAddress(), E(200), deadline);
      const nonceBefore = await musd.nonces(client.address);
      const tx = escrow.connect(client).fundWithPermit(id, deadline, sig.v, sig.r, sig.s);
      await expect(tx).to.emit(escrow, "ProjectFunded").withArgs(id, client.address, E(200));
      await expect(tx).to.changeTokenBalances(musd, [client, escrow], [-E(200), E(200)]);
      expect(await musd.nonces(client.address)).to.equal(nonceBefore + 1n);
      expect(await musd.allowance(client.address, await escrow.getAddress())).to.equal(0n);
      expect((await escrow.getProject(id)).status).to.equal(PS.Active);
    });

    it("still funds when the permit was front-run (allowance already set by the griefer's submission)", async () => {
      const { escrow, musd, client, stranger, id } = await acceptedProject();
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(musd, client, await escrow.getAddress(), E(200), deadline);
      // A griefer copies the signature from the mempool and submits it first.
      await musd.connect(stranger).permit(client.address, await escrow.getAddress(), E(200), deadline, sig.v, sig.r, sig.s);
      await expect(escrow.connect(client).fundWithPermit(id, deadline, sig.v, sig.r, sig.s)).to.emit(escrow, "ProjectFunded");
    });

    it("an invalid permit (wrong signer) with no allowance reverts on transferFrom", async () => {
      const { escrow, musd, client, stranger, id } = await acceptedProject();
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(musd, client, await escrow.getAddress(), E(200), deadline, stranger);
      await expect(escrow.connect(client).fundWithPermit(id, deadline, sig.v, sig.r, sig.s)).to.be.revertedWithCustomError(
        musd,
        "ERC20InsufficientAllowance",
      );
      expect((await escrow.getProject(id)).status).to.equal(PS.AwaitingFunding);
    });

    it("an expired permit is ignored but an existing approval still funds", async () => {
      const { escrow, musd, client, id } = await acceptedProject();
      const deadline = BigInt(await time.latest()) - 1n;
      const sig = await signPermit(musd, client, await escrow.getAddress(), E(200), deadline);
      await musd.connect(client).approve(await escrow.getAddress(), E(200));
      await expect(escrow.connect(client).fundWithPermit(id, deadline, sig.v, sig.r, sig.s)).to.emit(escrow, "ProjectFunded");
    });

    it("a permit cannot be used by a non-client to fund", async () => {
      const { escrow, musd, stranger, id } = await acceptedProject();
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(musd, stranger, await escrow.getAddress(), E(200), deadline);
      await expect(escrow.connect(stranger).fundWithPermit(id, deadline, sig.v, sig.r, sig.s)).to.be.revertedWithCustomError(
        escrow,
        "NotClient",
      );
    });

    it("reverts ProjectNotFound for an unknown project", async () => {
      const { escrow, client } = await loadFixture(baseFixture);
      await expect(escrow.connect(client).fundWithPermit(7n, 0, 27, ethers.ZeroHash, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, "ProjectNotFound")
        .withArgs(7n);
    });
  });

  it("fundProject helper sanity: funded project invariants hold", async () => {
    const { escrow, musd, client, id } = await acceptedProject();
    await fundProject(escrow, musd, client, id);
    await assertInvariants(escrow, musd);
  });
});
