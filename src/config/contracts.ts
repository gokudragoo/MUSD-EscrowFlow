import type { Address, Hex } from "viem";
import deployment from "./deployment.json";
import legacyDeployment from "./deployment-v1.json";
import { escrowFlowAbi } from "./abi/escrowFlow";
import { escrowFlowV1Abi } from "./abi/escrowFlowV1";
import { musdAbi } from "./abi/musd";

export { escrowFlowAbi, escrowFlowV1Abi, musdAbi };

/** Official MUSD token on Mezo testnet (docs + github.com/mezo-org/musd matsnet deployment). */
export const MUSD_ADDRESS: Address = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
export const MUSD_DECIMALS = 18;
export const MUSD_SYMBOL = "MUSD";

type Deployment = {
  escrowFlow: string;
  deployTx: string;
  deployBlock: number;
  deployer: string;
  version?: number;
  idOffset?: number;
  savingsVault?: string;
};
const current = deployment as Deployment;
const legacy = legacyDeployment as Deployment;

/** EscrowFlow v2 registry (scripts/deploy-escrow.ts writes deployment.json). New escrows go here. */
export const ESCROW_ADDRESS = current.escrowFlow as Address;
export const ESCROW_DEPLOY_TX = current.deployTx as Hex;
export const ESCROW_DEPLOY_BLOCK = BigInt(current.deployBlock);
export const ESCROW_DEPLOYER = current.deployer as Address;
export const ESCROW_VERSION = current.version ?? 1;
/** v2 ids start above this offset, so they never collide with the legacy v1 registry's ids. */
export const ESCROW_ID_OFFSET = BigInt(current.idOffset ?? 0);

/** EscrowFlow v1 (first deployment). Read-only in the app: its escrows are all settled test runs. */
export const LEGACY_ESCROW_ADDRESS = legacy.escrowFlow as Address;
export const LEGACY_ESCROW_DEPLOY_BLOCK = BigInt(legacy.deployBlock);
export const LEGACY_ESCROW_DEPLOY_TX = legacy.deployTx as Hex;
export const HAS_LEGACY_ESCROW = ESCROW_VERSION >= 2 && LEGACY_ESCROW_ADDRESS.toLowerCase() !== ESCROW_ADDRESS.toLowerCase();

export const isEscrowDeployed = () => ESCROW_ADDRESS !== "0x0000000000000000000000000000000000000000";

export interface EscrowTarget {
  address: Address;
  abi: typeof escrowFlowAbi;
  version: 1 | 2;
}

/** Which registry holds escrow `id`: ids above the offset live in v2, the rest in legacy v1. */
export function escrowForId(id: bigint): EscrowTarget {
  if (ESCROW_VERSION >= 2 && id <= ESCROW_ID_OFFSET && HAS_LEGACY_ESCROW) {
    // The v1 ABI is a strict subset for everything the app reads (getProject/getMilestones/views).
    return { address: LEGACY_ESCROW_ADDRESS, abi: escrowFlowV1Abi as unknown as typeof escrowFlowAbi, version: 1 };
  }
  return { address: ESCROW_ADDRESS, abi: escrowFlowAbi, version: ESCROW_VERSION >= 2 ? 2 : 1 };
}

export const isLegacyEscrowId = (id: bigint | string | null | undefined) =>
  id !== null && id !== undefined && escrowForId(BigInt(id)).version === 1 && HAS_LEGACY_ESCROW;

/** Every registry the indexer follows, newest first. */
export const ESCROW_REGISTRIES: { address: Address; deployBlock: bigint; abi: typeof escrowFlowAbi; version: 1 | 2 }[] = [
  { address: ESCROW_ADDRESS, deployBlock: ESCROW_DEPLOY_BLOCK, abi: escrowFlowAbi, version: ESCROW_VERSION >= 2 ? 2 : 1 },
  ...(HAS_LEGACY_ESCROW
    ? [{ address: LEGACY_ESCROW_ADDRESS, deployBlock: LEGACY_ESCROW_DEPLOY_BLOCK, abi: escrowFlowV1Abi as unknown as typeof escrowFlowAbi, version: 1 as const }]
    : []),
];

export const isEscrowAddress = (a?: string | null) =>
  !!a && ESCROW_REGISTRIES.some((r) => r.address.toLowerCase() === a.toLowerCase());

/**
 * Mezo MUSD-system contracts the app calls (all verified proxies on explorer.test.mezo.org).
 * - MUSDSavingsRate (sMUSD): where v2 escrows park held MUSD to earn the savings rate.
 * - BorrowerOperations / TroveManager / SortedTroves / PriceFeed: fund an escrow by drawing MUSD
 *   from (or opening) a trove against BTC collateral.
 */
export const SMUSD_ADDRESS: Address = (current.savingsVault as Address | undefined) ?? "0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16";
export const MEZO_SYSTEM_CONTRACTS = {
  BorrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  TroveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  SortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
  PriceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  StabilityPool: "0x1CCA7E410eE41739792eA0A24e00349Dd247680e",
  MUSDSavingsRate: "0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16",
} as const satisfies Record<string, Address>;
