import { json, route } from "@/lib/server/http";
import { serverClient } from "@/lib/server/chain";
import { ESCROW_ADDRESS, MUSD_ADDRESS, escrowFlowAbi, isEscrowDeployed, musdAbi } from "@/config/contracts";

export const dynamic = "force-dynamic";

/** Live network + contract numbers for the landing page (real on-chain reads, cached 20 s at the edge). */
export const GET = route(async () => {
  const [block, supply, projectCount, totalHeld, escrowBalance] = await Promise.all([
    serverClient.getBlock(),
    serverClient.readContract({ address: MUSD_ADDRESS, abi: musdAbi, functionName: "totalSupply" }),
    isEscrowDeployed() ? serverClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "projectCount" }) : 0n,
    isEscrowDeployed() ? serverClient.readContract({ address: ESCROW_ADDRESS, abi: escrowFlowAbi, functionName: "totalHeld" }) : 0n,
    isEscrowDeployed()
      ? serverClient.readContract({ address: MUSD_ADDRESS, abi: musdAbi, functionName: "balanceOf", args: [ESCROW_ADDRESS] })
      : 0n,
  ]);
  return json(
    {
      blockNumber: block.number.toString(),
      blockTime: Number(block.timestamp),
      musdTotalSupplyWei: supply.toString(),
      escrowProjects: projectCount.toString(),
      escrowHeldWei: totalHeld.toString(),
      escrowBalanceWei: escrowBalance.toString(),
      fetchedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "public, s-maxage=20, stale-while-revalidate=40" } },
  );
});
