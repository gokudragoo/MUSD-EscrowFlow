import type { Address, Hex } from "viem";
import deployment from "./deployment.json";
import { escrowFlowAbi } from "./abi/escrowFlow";
import { musdAbi } from "./abi/musd";

export { escrowFlowAbi, musdAbi };

/** Official MUSD token on Mezo testnet (docs + github.com/mezo-org/musd matsnet deployment). */
export const MUSD_ADDRESS: Address = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
export const MUSD_DECIMALS = 18;
export const MUSD_SYMBOL = "MUSD";

/** EscrowFlow registry deployed by scripts/deploy-escrow.ts (written to deployment.json). */
export const ESCROW_ADDRESS = deployment.escrowFlow as Address;
export const ESCROW_DEPLOY_TX = deployment.deployTx as Hex;
export const ESCROW_DEPLOY_BLOCK = BigInt(deployment.deployBlock);
export const ESCROW_DEPLOYER = deployment.deployer as Address;

export const isEscrowDeployed = () => ESCROW_ADDRESS !== "0x0000000000000000000000000000000000000000";

/** Other Mezo MUSD-system contracts referenced in docs/README (read-only context). */
export const MEZO_SYSTEM_CONTRACTS = {
  BorrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  TroveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  PriceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  StabilityPool: "0x1CCA7E410eE41739792eA0A24e00349Dd247680e",
} as const satisfies Record<string, Address>;
