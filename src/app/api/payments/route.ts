import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { projectIdsFor } from "@/lib/server/chain";
import { query } from "@/lib/server/db";
import { syncIfStale } from "@/lib/server/indexer";
import { chainEventTitle } from "@/lib/server/projects";
import { toDecimalString } from "@/lib/money";
import { explorerTx } from "@/config/chains";

export const dynamic = "force-dynamic";

const MONEY_EVENTS = ["ProjectFunded", "MilestoneReleased", "MilestoneRefunded", "DisputeResolved", "ProjectCancelled"];

interface Row {
  tx_hash: string;
  block_number: string;
  block_time: string | null;
  event_name: string;
  chain_project_id: string;
  milestone_index: number | null;
  args: Record<string, string | boolean>;
  title: string | null;
  project_id: string | null;
}

function csvCell(v: string) {
  return `"${v.replace(/"/g, '""')}"`;
}

/** Funding, releases, refunds and settlements for the signed-in wallet's escrows (on-chain facts). */
export const GET = route(async (req: NextRequest) => {
  const s = await requireSession();
  after(() => syncIfStale());
  const ids = await projectIdsFor(s.address);
  const all = [...new Set([...ids.asClient, ...ids.asFreelancer].map(String))];
  const rows = all.length
    ? await query<Row>(
        `select e.tx_hash, e.block_number::text as block_number, e.block_time, e.event_name, e.chain_project_id::text as chain_project_id,
                e.milestone_index, e.args, p.title, p.id as project_id
           from escrowflow.chain_events e left join escrowflow.projects p on p.chain_project_id = e.chain_project_id
          where e.chain_project_id = any($1::bigint[]) and e.event_name = any($2::text[])
          order by e.block_number desc, e.log_index desc limit 500`,
        [all, MONEY_EVENTS],
      )
    : [];
  const me = s.address.toLowerCase();
  const items = rows
    .filter((r) => !(r.event_name === "ProjectCancelled" && !r.args.wasFunded))
    // Mutual-cancellation refunds are summarised by ProjectCancelled; skip per-milestone duplicates.
    .filter((r) => !(r.event_name === "MilestoneRefunded" && Number(r.args.kind) === 1))
    .map((r) => {
      const amount = String(r.args.amount ?? r.args.refundedAmount ?? "0");
      const freelancerAmount = r.args.freelancerAmount !== undefined ? String(r.args.freelancerAmount) : null;
      const clientAmount = r.args.clientAmount !== undefined ? String(r.args.clientAmount) : null;
      let direction: "in" | "out" | "info" = "info";
      if (r.event_name === "ProjectFunded" && String(r.args.client).toLowerCase() === me) direction = "out";
      if (r.event_name === "MilestoneReleased" && String(r.args.freelancer).toLowerCase() === me) direction = "in";
      return {
        txHash: r.tx_hash,
        explorerUrl: explorerTx(r.tx_hash),
        blockNumber: r.block_number,
        at: r.block_time,
        event: r.event_name,
        title: chainEventTitle(r.event_name),
        chainProjectId: r.chain_project_id,
        projectId: r.project_id,
        projectTitle: r.title ?? `Escrow #${r.chain_project_id}`,
        milestoneIndex: r.milestone_index,
        amountWei: r.event_name === "DisputeResolved" ? String(BigInt(freelancerAmount ?? "0") + BigInt(clientAmount ?? "0")) : amount,
        freelancerAmountWei: freelancerAmount,
        clientAmountWei: clientAmount,
        direction,
      };
    });
  if (req.nextUrl.searchParams.get("format") === "csv") {
    const header = "time,event,project,milestone,amount_musd,freelancer_musd,client_musd,tx_hash,explorer\n";
    const body = items
      .map((i) =>
        [
          i.at ?? "",
          i.event,
          csvCell(i.projectTitle),
          i.milestoneIndex == null ? "" : String(i.milestoneIndex + 1),
          toDecimalString(BigInt(i.amountWei)),
          i.freelancerAmountWei ? toDecimalString(BigInt(i.freelancerAmountWei)) : "",
          i.clientAmountWei ? toDecimalString(BigInt(i.clientAmountWei)) : "",
          i.txHash,
          i.explorerUrl,
        ].join(","),
      )
      .join("\n");
    return new NextResponse(header + body + "\n", {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="escrowflow-payments.csv"',
        "cache-control": "no-store",
      },
    });
  }
  return json({ items });
});
