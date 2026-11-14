import { json, route } from "@/lib/server/http";
import { serverClient } from "@/lib/server/chain";
import { query } from "@/lib/server/db";
import { ESCROW_REGISTRIES, MUSD_ADDRESS, SMUSD_ADDRESS, isEscrowDeployed, musdAbi } from "@/config/contracts";
import { savingsRateAbi } from "@/config/abi/mezo";

export const dynamic = "force-dynamic";

/**
 * Live network + contract numbers for the landing page. Money figures are real on-chain reads
 * across every EscrowFlow registry; wallet counts come from the verified event cache.
 */
export const GET = route(async () => {
  const deployed = isEscrowDeployed();
  const perRegistry = deployed
    ? await Promise.all(
        ESCROW_REGISTRIES.map(async (r) => {
          const [count, held, inSavings] = await Promise.all([
            serverClient.readContract({ address: r.address, abi: r.abi, functionName: "projectCount" }).catch(() => 0n),
            serverClient.readContract({ address: r.address, abi: r.abi, functionName: "totalHeld" }).catch(() => 0n),
            r.version === 2
              ? serverClient.readContract({ address: SMUSD_ADDRESS, abi: savingsRateAbi, functionName: "balanceOf", args: [r.address] }).catch(() => 0n)
              : Promise.resolve(0n),
          ]);
          return { count: BigInt(count), held: BigInt(held), inSavings: BigInt(inSavings) };
        }),
      )
    : [];
  const [block, supply, wallets] = await Promise.all([
    serverClient.getBlock(),
    serverClient.readContract({ address: MUSD_ADDRESS, abi: musdAbi, functionName: "totalSupply" }),
    query<{ wallets: number; clients: number; freelancers: number; released: string | null }>(
      `with parties as (
         select lower(args->>'client') as client, lower(args->>'freelancer') as freelancer
           from escrowflow.chain_events where event_name = 'ProjectCreated')
       select (select count(distinct a)::int from (select client as a from parties union select freelancer from parties) u) as wallets,
              (select count(distinct client)::int from parties) as clients,
              (select count(distinct freelancer)::int from parties) as freelancers,
              (select coalesce(sum(case when event_name = 'MilestoneReleased' then (args->>'amount')::numeric
                                         else (args->>'freelancerAmount')::numeric end), 0)::text
                 from escrowflow.chain_events where event_name in ('MilestoneReleased', 'DisputeResolved')) as released`,
    ).catch(() => [{ wallets: 0, clients: 0, freelancers: 0, released: "0" }]),
  ]);
  const sum = (k: "count" | "held" | "inSavings") => perRegistry.reduce((a, r) => a + r[k], 0n);
  const w = wallets[0];
  return json(
    {
      blockNumber: block.number.toString(),
      blockTime: Number(block.timestamp),
      musdTotalSupplyWei: supply.toString(),
      escrowProjects: sum("count").toString(),
      escrowHeldWei: sum("held").toString(),
      escrowInSavingsWei: sum("inSavings").toString(),
      releasedWei: w?.released ?? "0",
      uniqueWallets: w?.wallets ?? 0,
      uniqueClients: w?.clients ?? 0,
      uniqueFreelancers: w?.freelancers ?? 0,
      fetchedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "public, s-maxage=20, stale-while-revalidate=40" } },
  );
});
