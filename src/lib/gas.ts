/**
 * Mezo testnet enforces the EIP-7623 calldata gas floor and the public RPC has been observed to
 * return bogus (too-low) estimates. Every write therefore passes an explicit gas limit:
 *   gas = max(estimate * 13 / 10, floor)
 * Estimates below 30k for contract calls are treated as invalid and replaced by the floor.
 * Gas price on Mezo testnet is ~150 wei, so generous limits cost effectively nothing.
 */

export type EscrowWrite =
  | "createProject"
  | "updateTerms"
  | "acceptTerms"
  | "revokeAcceptance"
  | "cancelUnfunded"
  | "fund"
  | "fundWithPermit"
  | "submitMilestone"
  | "requestChanges"
  | "approveAndRelease"
  | "claimAfterReviewTimeout"
  | "reclaimExpiredMilestone"
  | "openDispute"
  | "proposeSettlement"
  | "acceptSettlement"
  | "arbiterResolve"
  | "withdrawDispute"
  | "proposeCancellation"
  | "revokeCancellation"
  | "acceptCancellation";

const BASE_FLOORS: Record<EscrowWrite, bigint> = {
  createProject: 450_000n,
  updateTerms: 450_000n,
  acceptTerms: 150_000n,
  revokeAcceptance: 120_000n,
  cancelUnfunded: 120_000n,
  fund: 320_000n,
  fundWithPermit: 380_000n,
  submitMilestone: 220_000n,
  requestChanges: 160_000n,
  approveAndRelease: 260_000n,
  claimAfterReviewTimeout: 260_000n,
  reclaimExpiredMilestone: 260_000n,
  openDispute: 220_000n,
  proposeSettlement: 160_000n,
  acceptSettlement: 320_000n,
  arbiterResolve: 320_000n,
  withdrawDispute: 160_000n,
  proposeCancellation: 130_000n,
  revokeCancellation: 110_000n,
  acceptCancellation: 320_000n,
};

/** Extra floor per milestone for functions whose cost scales with milestone count. */
const PER_MILESTONE: Partial<Record<EscrowWrite, bigint>> = {
  createProject: 90_000n,
  updateTerms: 90_000n,
  fund: 8_000n,
  fundWithPermit: 8_000n,
  acceptCancellation: 45_000n,
};

export const ERC20_GAS_FLOOR = 90_000n;
export const MIN_VALID_CONTRACT_ESTIMATE = 30_000n;

export function gasFloor(fn: EscrowWrite, milestoneCount = 0): bigint {
  const base = BASE_FLOORS[fn];
  const per = PER_MILESTONE[fn] ?? 0n;
  return base + per * BigInt(Math.max(0, Math.min(milestoneCount, 20)));
}

/** max(estimate × 1.3, floor); an estimate below 30k (or missing) is treated as invalid. */
export function withGasBuffer(estimate: bigint | null | undefined, floor: bigint): bigint {
  if (estimate == null || estimate < MIN_VALID_CONTRACT_ESTIMATE) return floor;
  const buffered = (estimate * 13n) / 10n;
  return buffered > floor ? buffered : floor;
}

/** Transient RPC / nonce errors worth retrying (scripts + deployer). */
export function isRetryableTxError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("nonce too low") ||
    m.includes("replacement transaction underpriced") ||
    m.includes("replacement underpriced") ||
    m.includes("already known") ||
    m.includes("nonce has already been used") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("fetch failed") ||
    m.includes("socket hang up") ||
    m.includes("econnreset") ||
    m.includes("429") ||
    m.includes("503") ||
    m.includes("502")
  );
}
