/**
 * Wallets operated by the EscrowFlow team for deployment and automated end-to-end tests. The public
 * activity page labels escrows between these wallets as "team test", so outside usage is easy to tell
 * apart from our own runs. This list only ever adds labels; it never hides anything.
 */
export const TEAM_WALLETS: Record<string, string> = {
  "0x10ac9924a78051bdd770978740c5084205cdb628": "Deployer",
  "0x85bfeb7fea972e1269f14526e0195a7a841a3efe": "E2E client (v1 runs)",
  "0x430999f89d1d1425e48af2904dca0cfe2cd7034f": "E2E freelancer (v1 runs)",
  "0xdf6a10b8b00f5527a0f17fdbf31321197e7f5716": "E2E client (v2 runs)",
  "0xc4c2ce735e0f0e84ed6880abbbafa744e0910ff4": "E2E freelancer (v2 runs)",
  "0x52ffe13164fcf7417f456edd33625bc6b9053ebf": "E2E stranger (v2 runs)",
};

export const teamLabel = (address?: string | null) => (address ? (TEAM_WALLETS[address.toLowerCase()] ?? null) : null);
