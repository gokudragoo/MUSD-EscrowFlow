import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getAddress } from "viem";
import { badRequest, conflict, forbidden, json, notFound, parseJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { getProjectRow } from "@/lib/server/projects";
import { audit, notify } from "@/lib/server/records";
import { applicationInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

interface AppRow {
  id: string;
  freelancer_address: string;
  introduction: string;
  skills: string[];
  portfolio_links: string[];
  proposed_timeline: string;
  proposal: string;
  status: string;
  created_at: string;
  display_name: string | null;
  headline: string | null;
}

const toApp = (r: AppRow) => ({
  id: r.id,
  freelancer: getAddress(r.freelancer_address),
  introduction: r.introduction,
  skills: r.skills,
  portfolioLinks: r.portfolio_links,
  proposedTimeline: r.proposed_timeline,
  proposal: r.proposal,
  status: r.status,
  createdAt: r.created_at,
  displayName: r.display_name,
  headline: r.headline,
});

/** Client sees every application; an applicant sees only their own. */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  const row = await getProjectRow(id);
  if (!row) throw notFound("Project not found");
  const me = s.address.toLowerCase();
  const isClient = row.client_address === me;
  const rows = await query<AppRow>(
    `select a.id, a.freelancer_address, a.introduction, a.skills, a.portfolio_links, a.proposed_timeline, a.proposal, a.status, a.created_at,
            p.display_name, p.headline
       from escrowflow.applications a left join escrowflow.profiles p on p.address = a.freelancer_address
      where a.project_id = $1 ${isClient ? "" : "and a.freelancer_address = $2"} order by a.created_at asc`,
    isClient ? [id] : [id, me],
  );
  return json({ applications: rows.map(toApp), isClient });
});

/** Flow B: a freelancer applies to an open listing. */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  const body = await parseJson(req, applicationInputSchema);
  const row = await getProjectRow(id);
  if (!row) throw notFound("Project not found");
  if (row.listing_status !== "open") throw conflict("This listing is not accepting applications");
  const me = s.address.toLowerCase();
  if (row.client_address === me) throw forbidden("You cannot apply to your own project");
  if (row.terms.rules.arbiter && row.terms.rules.arbiter.toLowerCase() === me) throw badRequest("The arbiter cannot apply");
  const appId = randomUUID();
  const inserted = await query(
    `insert into escrowflow.applications (id, project_id, freelancer_address, introduction, skills, portfolio_links, proposed_timeline, proposal)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (project_id, freelancer_address) do nothing returning id`,
    [appId, id, me, body.introduction, body.skills, JSON.stringify(body.portfolioLinks), body.proposedTimeline, body.proposal],
  );
  if (inserted.length === 0) throw conflict("You have already applied to this project");
  await query(`insert into escrowflow.users (address) values ($1) on conflict do nothing`, [me]);
  await audit(id, s.address, "application_submitted", { title: "Application received", summary: `From ${s.address.slice(0, 8)}…` });
  await notify({
    recipient: row.client_address,
    kind: "application",
    title: `New application: ${row.title}`,
    body: body.introduction.slice(0, 140),
    href: `/projects/${id}?tab=applications`,
    source: "app",
    dedupeKey: `app:${appId}`,
  });
  return json({ id: appId }, { status: 201 });
});
