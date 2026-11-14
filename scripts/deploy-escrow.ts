/**
 * Deploys EscrowFlow v2 (MUSD, sMUSD savings vault, id offset) to Mezo testnet with the owner's deployer key.
 *   npm run contracts:compile && npm run contracts:abi && npm run contracts:deploy
 * The key is read at runtime from DEPLOYER_ENV_FILE (default C:\Users\nikku\Desktop\.env.txt)
 * and is never written to disk, logged, or bundled.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeAbiParameters, concat, type Address, type Hex, getAddress, parseAbi } from "viem";
import { loadDeployerAccount, publicClient, sendRaw } from "./lib/tx";
import { MUSD_ADDRESS, escrowFlowAbi } from "../src/config/contracts";
import { explorerAddress, explorerTx } from "../src/config/chains";

/** Mezo MUSDSavingsRate (sMUSD) vault on Mezo testnet — where yield-enabled escrows park held MUSD. */
const SMUSD_VAULT: Address = "0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16";
/** v2 project ids start at ID_OFFSET + 1 so they never collide with the legacy v1 registry's ids. */
const ID_OFFSET = 1000n;
/** ~5.07M gas measured on a local Mezo fork for the ~23 KB runtime; floor keeps a ~1.3x margin. */
const DEPLOY_GAS_FLOOR = 6_800_000n;

async function main() {
  const root = path.resolve(__dirname, "..");
  const { bytecode } = JSON.parse(
    readFileSync(path.join(root, "scripts", "build", "EscrowFlow.bytecode.json"), "utf8"),
  ) as { bytecode: Hex };

  const account = loadDeployerAccount();
  const chainId = await publicClient.getChainId();
  if (chainId !== 31611) throw new Error(`Unexpected chain ${chainId}`);
  console.log(`Deployer ${account.address} on chain ${chainId}`);

  // Pre-flight: the vault must be the sMUSD vault of MUSD (the constructor enforces the same).
  const vaultToken = await publicClient.readContract({
    address: SMUSD_VAULT,
    abi: parseAbi(["function musdToken() view returns (address)"]),
    functionName: "musdToken",
  });
  if (getAddress(vaultToken) !== getAddress(MUSD_ADDRESS)) {
    throw new Error(`sMUSD vault ${SMUSD_VAULT} is for token ${vaultToken}, not MUSD ${MUSD_ADDRESS}`);
  }

  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [MUSD_ADDRESS, SMUSD_VAULT, ID_OFFSET],
  );
  const data = concat([bytecode, args]);
  const { hash, receipt } = await sendRaw({ account, data, gasFloor: DEPLOY_GAS_FLOOR, label: "deploy EscrowFlow v2" });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deploy failed: ${hash}`);
  const address = getAddress(receipt.contractAddress);

  // Sanity: immutables must be MUSD / sMUSD / 1000 and the registry must be empty.
  const read = async <T>(functionName: "token" | "savingsVault" | "ID_OFFSET" | "projectCount"): Promise<T> => {
    let lastErr: unknown;
    for (let i = 0; i < 5; i++) {
      try {
        return (await publicClient.readContract({ address, abi: escrowFlowAbi, functionName })) as T;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw lastErr;
  };
  const token = await read<string>("token");
  if (getAddress(token) !== getAddress(MUSD_ADDRESS)) throw new Error("token() mismatch after deploy");
  const vault = await read<string>("savingsVault");
  if (getAddress(vault) !== getAddress(SMUSD_VAULT)) throw new Error("savingsVault() mismatch after deploy");
  const offset = await read<bigint>("ID_OFFSET");
  if (offset !== ID_OFFSET) throw new Error(`ID_OFFSET() mismatch after deploy: ${offset}`);
  const count = await read<bigint>("projectCount");
  if (count !== 0n) throw new Error(`projectCount() is ${count} on a fresh deploy`);

  const deployment = {
    chainId,
    version: 2,
    escrowFlow: address,
    savingsVault: getAddress(SMUSD_VAULT),
    idOffset: Number(ID_OFFSET),
    deployTx: hash,
    deployBlock: Number(receipt.blockNumber),
    deployer: account.address,
    deployedAt: new Date().toISOString(),
    gasUsed: receipt.gasUsed.toString(),
  };
  writeFileSync(path.join(root, "src", "config", "deployment.json"), JSON.stringify(deployment, null, 2) + "\n");
  console.log(`EscrowFlow v2 deployed at ${address}`);
  console.log(`  tx     ${explorerTx(hash)}`);
  console.log(`  addr   ${explorerAddress(address)}`);
  console.log(`  vault  ${SMUSD_VAULT}   idOffset ${ID_OFFSET}`);
  console.log(`  block  ${receipt.blockNumber} gasUsed ${receipt.gasUsed}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
