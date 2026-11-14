/**
 * Tops up the throwaway e2e wallets from the deployer:
 *   - native BTC for gas to client / freelancer / stranger (only if below a small threshold)
 *   - MUSD to the client (enough for the e2e scenario)
 * When the deployer itself is short on MUSD, it borrows the gap from its own Mezo trove through
 * BorrowerOperations.withdrawMUSD — the same path (fee preview, MCR + capacity checks, sorted-list
 * hints from SortedTroves.findInsertPosition) that the app's "Borrow MUSD against BTC" panel uses.
 *
 *   npx tsx scripts/fund-test-wallets.ts            (E2E_MUSD=30 by default)
 * Keys are read at runtime from files outside the repo and never printed.
 */
import { formatEther, parseEther, zeroAddress, type Address, type Hex } from "viem";
import { loadDeployerAccount, loadTestWallets, publicClient, sendRaw, writeContract } from "./lib/tx";
import { MEZO_SYSTEM_CONTRACTS, MUSD_ADDRESS, musdAbi } from "../src/config/contracts";
import { borrowerOperationsAbi, priceFeedAbi, sortedTrovesAbi, troveManagerAbi } from "../src/config/abi/mezo";
import { ERC20_GAS_FLOOR } from "../src/lib/gas";
import { explorerTx } from "../src/config/chains";
import { formatCr, maxDraw, planDraw, type TroveParams, type TroveState } from "../src/lib/trove";

const GAS_TARGET = parseEther("0.002");
const GAS_MIN = parseEther("0.0005");
const MUSD_TARGET = parseEther(process.env.E2E_MUSD ?? "30");
/** Never let a top-up borrow push the deployer's trove below this ratio. */
const SAFE_CR = (125n * 10n ** 18n) / 100n;

const BO = MEZO_SYSTEM_CONTRACTS.BorrowerOperations as Address;
const TM = MEZO_SYSTEM_CONTRACTS.TroveManager as Address;
const ST = MEZO_SYSTEM_CONTRACTS.SortedTroves as Address;
const PF = MEZO_SYSTEM_CONTRACTS.PriceFeed as Address;

const musdOf = (a: Address) => publicClient.readContract({ address: MUSD_ADDRESS, abi: musdAbi, functionName: "balanceOf", args: [a] });

async function borrowFromTrove(deployer: ReturnType<typeof loadDeployerAccount>, amount: bigint) {
  const r = <T>(address: Address, abi: unknown, functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address, abi: abi as never, functionName, args } as never) as Promise<T>;
  const a = deployer.address;
  const [status, coll, debt, principal, cap, price, rate, mcr, minNetDebt, gasComp] = await Promise.all([
    r<number>(TM, troveManagerAbi, "getTroveStatus", [a]),
    r<bigint>(TM, troveManagerAbi, "getTroveColl", [a]),
    r<bigint>(TM, troveManagerAbi, "getTroveDebt", [a]),
    r<bigint>(TM, troveManagerAbi, "getTrovePrincipal", [a]),
    r<bigint>(TM, troveManagerAbi, "getTroveMaxBorrowingCapacity", [a]),
    r<bigint>(PF, priceFeedAbi, "fetchPrice"),
    r<bigint>(BO, borrowerOperationsAbi, "borrowingRate"),
    r<bigint>(BO, borrowerOperationsAbi, "MCR"),
    r<bigint>(BO, borrowerOperationsAbi, "minNetDebt"),
    r<bigint>(BO, borrowerOperationsAbi, "MUSD_GAS_COMPENSATION"),
  ]);
  const t: TroveState = { status: Number(status), coll, debt, principal, maxCapacity: cap };
  const p: TroveParams = { price, borrowingRate: rate, minNetDebt, gasCompensation: gasComp, mcr };
  const plan = planDraw(t, p, amount);
  console.log(`  deployer trove: ${formatEther(coll)} BTC, debt ${formatEther(debt)} MUSD, CR ${formatCr((coll * price) / debt)}, max draw ${formatEther(maxDraw(t, p))}`);
  if (!plan.ok) throw new Error(`Trove cannot lend ${formatEther(amount)} MUSD (capacity ${plan.capacityOk}, MCR ${plan.crOk})`);
  if (plan.newCr < SAFE_CR) throw new Error(`Borrowing ${formatEther(amount)} would leave the trove at ${formatCr(plan.newCr)} (< 125%); refusing`);
  const [upper, lower] = await r<[Address, Address]>(ST, sortedTrovesAbi, "findInsertPosition", [plan.nicr, zeroAddress, zeroAddress]);
  const before = await musdOf(a);
  const { hash, receipt } = await writeContract({
    account: deployer,
    address: BO,
    abi: borrowerOperationsAbi as never,
    functionName: "withdrawMUSD",
    args: [amount, upper, lower],
    gasFloor: 1_200_000n,
    label: "BorrowerOperations.withdrawMUSD",
  });
  if (receipt.status !== "success") throw new Error(`withdrawMUSD reverted: ${explorerTx(hash)}`);
  const got = (await musdOf(a)) - before;
  console.log(`  borrowed ${formatEther(got)} MUSD (fee ${formatEther(plan.fee)}), CR now ≈ ${formatCr(plan.newCr)}  ${explorerTx(hash)}`);
  if (got !== amount) throw new Error(`Expected exactly ${formatEther(amount)} MUSD, received ${formatEther(got)}`);
  return hash as Hex;
}

async function main() {
  const deployer = loadDeployerAccount();
  const w = loadTestWallets("escrowflow");
  console.log(`Deployer ${deployer.address}`);

  for (const role of ["client", "freelancer", "stranger"] as const) {
    const bal = await publicClient.getBalance({ address: w[role].address });
    if (bal >= GAS_MIN) {
      console.log(`  ${role} ${w[role].address} has ${formatEther(bal)} BTC — ok`);
      continue;
    }
    const { hash } = await sendRaw({ account: deployer, to: w[role].address, data: "0x", value: GAS_TARGET - bal, gasFloor: 30_000n, label: `gas → ${role}` });
    console.log(`  sent ${formatEther(GAS_TARGET - bal)} BTC to ${role}  ${explorerTx(hash)}`);
  }

  const clientMusd = await musdOf(w.client.address);
  if (clientMusd >= MUSD_TARGET) {
    console.log(`  client already holds ${formatEther(clientMusd)} MUSD — ok`);
    return;
  }
  const need = MUSD_TARGET - clientMusd;
  const deployerMusd = await musdOf(deployer.address);
  if (deployerMusd < need) await borrowFromTrove(deployer, need - deployerMusd);
  const { hash, receipt } = await writeContract({
    account: deployer,
    address: MUSD_ADDRESS,
    abi: musdAbi as never,
    functionName: "transfer",
    args: [w.client.address, need],
    gasFloor: ERC20_GAS_FLOOR,
    label: "MUSD → client",
  });
  if (receipt.status !== "success") throw new Error("MUSD transfer reverted");
  console.log(`  sent ${formatEther(need)} MUSD to client  ${explorerTx(hash)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
