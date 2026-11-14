import { after } from "next/server";
import { getAddress } from "viem";
import { json, route } from "@/lib/server/http";
import { query } from "@/lib/server/db";
import { readProjects } from "@/lib/server/chain";
import { syncIfStale } from "@/lib/server/indexer";
import { ledgerOf, PROJECT_STATUS_LABEL } from "@/lib/escrow-state";
import { escrowForId } from "@/config/contracts";
import { teamLabel } from "@/config/team";

export const dynamic = "force-dynamic";

/**
 * Public network activity: every escrow created on EscrowFlow (v1 + v2), newest first, with its
 * parties and live balances read from the contracts. Only public on-chain facts — no private terms.
 */
export const GET = route(async () => {
  after(() => syncIfStale());
  const created = await query<{ chain_project_id: string; block_time: string | null; tx_hash: string; args: Record<string, string> }>(
    `select chain_project_id::text as chain_project_id, block_time, tx_hash, args
       from escrowflow.chain_events where event_name = 'ProjectCreated'
      order by block_number desc, log_index desc limit 60`,
  );
  const snaps = await readProjects(created.map((r) => BigInt(r.chain_project_id)));
  const byId = new Map(snaps.map((s) => [s.id.toString(), s]));
  const escrows = created.map((r) => {
    const snap = byId.get(r.chain_project_id);
    const client = getAddress(r.args.client);
    const freelancer = getAddress(snap?.project.freelancer ?? r.args.freelancer);
    const ledger = snap ? ledgerOf(snap.project) : null;
    const clientTeam = teamLabel(client);
    const freelancerTeam = teamLabel(freelancer);
    return {
      id: r.chain_project_id,
      version: escrowForId(BigInt(r.chain_project_id)).version,
      createdAt: r.block_time,
      txHash: r.tx_hash,
      client,
      freelancer,
      clientTeam,
      freelancerTeam,
      team: !!clientTeam && !!freelancerTeam,
      status: snap ? PROJECT_STATUS_LABEL[snap.project.status] : "Unknown",
      milestones: snap?.project.milestoneCount ?? null,
      total: snap?.project.totalAmount.toString() ?? null,
      funded: ledger?.funded.toString() ?? null,
      released: ledger?.released.toString() ?? null,
      refunded: ledger?.refunded.toString() ?? null,
      held: ledger?.held.toString() ?? null,
      savings: snap?.yield?.enabled ?? false,
    };
  });
  const wallets = new Set(escrows.flatMap((e) => [e.client.toLowerCase(), e.freelancer.toLowerCase()]));
  const external = [...wallets].filter((w) => !teamLabel(w));
  return json(
    { escrows, wallets: wallets.size, externalWallets: external.length, externalEscrows: escrows.filter((e) => !e.team).length },
    { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=30" } },
  );
});
