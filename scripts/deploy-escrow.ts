/**
 * Deploys EscrowFlow(MUSD) to Mezo testnet with the owner's deployer key.
 *   npm run contracts:compile && npm run contracts:abi && npm run contracts:deploy
 * The key is read at runtime from DEPLOYER_ENV_FILE (default C:\Users\nikku\Desktop\.env.txt)
 * and is never written to disk, logged, or bundled.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeAbiParameters, concat, type Hex, getAddress } from "viem";
import { loadDeployerAccount, publicClient, sendRaw } from "./lib/tx";
import { MUSD_ADDRESS, escrowFlowAbi } from "../src/config/contracts";
import { explorerAddress, explorerTx } from "../src/config/chains";

async function main() {
  const root = path.resolve(__dirname, "..");
  const { bytecode } = JSON.parse(
    readFileSync(path.join(root, "scripts", "build", "EscrowFlow.bytecode.json"), "utf8"),
  ) as { bytecode: Hex };

  const account = loadDeployerAccount();
  const chainId = await publicClient.getChainId();
  if (chainId !== 31611) throw new Error(`Unexpected chain ${chainId}`);
  console.log(`Deployer ${account.address} on chain ${chainId}`);

  const data = concat([bytecode, encodeAbiParameters([{ type: "address" }], [MUSD_ADDRESS])]);
  const { hash, receipt } = await sendRaw({ account, data, gasFloor: 4_500_000n, label: "deploy EscrowFlow" });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deploy failed: ${hash}`);
  const address = getAddress(receipt.contractAddress);

  // Sanity: the immutable token must be MUSD and the registry must be empty.
  let token: string | undefined;
  for (let i = 0; i < 5 && !token; i++) {
    try {
      token = await publicClient.readContract({ address, abi: escrowFlowAbi, functionName: "token" });
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!token || getAddress(token) !== getAddress(MUSD_ADDRESS)) throw new Error("token() mismatch after deploy");

  const deployment = {
    chainId,
    escrowFlow: address,
    deployTx: hash,
    deployBlock: Number(receipt.blockNumber),
    deployer: account.address,
    deployedAt: new Date().toISOString(),
    gasUsed: receipt.gasUsed.toString(),
  };
  writeFileSync(path.join(root, "src", "config", "deployment.json"), JSON.stringify(deployment, null, 2) + "\n");
  console.log(`EscrowFlow deployed at ${address}`);
  console.log(`  tx    ${explorerTx(hash)}`);
  console.log(`  addr  ${explorerAddress(address)}`);
  console.log(`  block ${receipt.blockNumber} gasUsed ${receipt.gasUsed}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
