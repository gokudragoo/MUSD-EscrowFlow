import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, requestOrigin } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { requireProjectAccess } from "@/lib/server/projects";
import { buildIcs } from "@/lib/ics";
import { formatMusd } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Milestone deadlines as an .ics calendar (on-chain deadlines when the escrow exists). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const s = await requireSession();
    const { row, chain } = await requireProjectAccess(id, s.address, ["client", "freelancer", "arbiter"]);
    const { origin } = requestOrigin(req);
    const events = row.terms.milestones.map((m, i) => {
      const deadline = chain?.milestones[i] ? Number(chain.milestones[i].deadline) : m.deadline;
      const amount = chain?.milestones[i]?.amount ?? BigInt(m.amount);
      return {
        uid: `${row.id}-m${i + 1}@escrowflow`,
        start: new Date(deadline * 1000),
        title: `Due: ${row.title} · M${i + 1} ${m.title}`,
        description: `${formatMusd(amount)} MUSD · review period ${Math.round(m.reviewPeriodSeconds / 3600)}h${chain ? ` · escrow #${chain.id}` : ""}`,
        url: `${origin}/projects/${row.id}`,
      };
    });
    const ics = buildIcs(`EscrowFlow · ${row.title}`, events);
    return new NextResponse(ics, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="escrowflow-${row.id.slice(0, 8)}.ics"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
