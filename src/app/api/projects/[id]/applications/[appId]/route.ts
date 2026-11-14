import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAddress } from "viem";
import { conflict, forbidden, json, notFound, parseJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { one, query, transaction } from "@/lib/server/db";
import { getProjectRow, isUuid } from "@/lib/server/projects";
import { notify } from "@/lib/server/records";
import { hashTerms, type TermsDocument } from "@/lib/terms";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; appId: string }> };

/** select / decline (client) or withdraw (applicant). Selecting writes the freelancer into a new terms revision. */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id, appId } = await ctx.params;
  const s = await requireSession();
  const { action } = await parseJson(req, z.object({ action: z.enum(["select", "decline", "withdraw"]) }));
  const row = await getProjectRow(id);
  if (!row) throw notFound("Project not found");
  if (!isUuid(appId)) throw notFound("Application not found");
  const app = await one<{ id: string; freelancer_address: string; status: string }>(
    `select id, freelancer_address, status from escrowflow.applications where id = $1 and project_id = $2`,
    [appId, id],
  );
  if (!app) throw notFound("Application not found");
  const me = s.address.toLowerCase();

  if (action === "withdraw") {
    if (app.freelancer_address !== me) throw forbidden("Only the applicant can withdraw");
    if (app.status !== "submitted") throw conflict("Only a pending application can be withdrawn");
    await transaction([{ text: `update escrowflow.applications set status='withdrawn', updated_at=now() where id=$1`, params: [appId] }]);
    return json({ ok: true });
  }
  if (row.client_address !== me) throw forbidden("Only the client can review applications");
  if (row.chain_project_id) throw conflict("The escrow already exists; the freelancer can only change via a terms update");
  if (row.listing_status !== "open") throw conflict("This listing is closed");
  if (app.status !== "submitted") throw conflict(`This application was already ${app.status}`);

  if (action === "decline") {
    await transaction([{ text: `update escrowflow.applications set status='declined', updated_at=now() where id=$1`, params: [appId] }]);
    await notify({
      recipient: app.freelancer_address,
      kind: "application",
      title: `Application not selected: ${row.title}`,
      href: `/marketplace`,
      source: "app",
      dedupeKey: `app-decline:${appId}`,
    });
    return json({ ok: true });
  }

  // select
  const freelancer = getAddress(app.freelancer_address);
  const terms: TermsDocument = { ...row.terms, freelancer };
  const hash = hashTerms(terms);
  const last = await one<{ revision: number }>(`select max(revision) as revision from escrowflow.terms_revisions where project_id = $1`, [id]);
  const revision = (last?.revision ?? 0) + 1;
  try {
  await transaction([
    { text: `update escrowflow.applications set status = 'selected', updated_at = now() where id = $1`, params: [appId] },
    {
      text: `update escrowflow.projects set freelancer_address = $2, terms = $3, terms_hash = $4, listing_status = 'closed', updated_at = now() where id = $1`,
      params: [id, freelancer.toLowerCase(), JSON.stringify(terms), hash],
    },
    {
      text: `insert into escrowflow.terms_revisions (project_id, revision, terms, terms_hash, author, note) values ($1,$2,$3,$4,$5,$6)`,
      params: [id, revision, JSON.stringify(terms), hash, me, `Freelancer selected: ${freelancer}`],
    },
    {
      text: `insert into escrowflow.audit_events (project_id, actor, action, detail) values ($1,$2,'freelancer_selected',$3)`,
      params: [id, me, JSON.stringify({ title: "Freelancer selected", summary: `${freelancer} · listing closed` })],
    },
  ]);
  } catch (e) {
    // Two concurrent edits raced for the same revision number: ask the client to retry.
    if (String((e as Error)?.message).includes("terms_revisions_project_id_revision_key") || (e as { code?: string })?.code === "23505") {
      throw conflict("The terms changed at the same moment. Reload and try again.");
    }
    throw e;
  }
  // Everyone else who applied is declined and told, instead of waiting on a closed listing.
  const others = await query<{ id: string; freelancer_address: string }>(
    `update escrowflow.applications set status = 'declined', updated_at = now()
      where project_id = $1 and id <> $2 and status = 'submitted' returning id, freelancer_address`,
    [id, appId],
  );
  for (const o of others) {
    await notify({
      recipient: o.freelancer_address,
      kind: "application",
      title: `Another freelancer was selected for ${row.title}`,
      body: "The listing is closed. Thanks for applying.",
      href: "/marketplace",
      source: "app",
      dedupeKey: `app-decline:${o.id}`,
    });
  }
  await notify({
    recipient: freelancer,
    kind: "application",
    title: `You were selected for ${row.title}`,
    body: "The client will create the escrow on-chain next. You'll then review and accept the final terms.",
    href: `/projects/${id}`,
    source: "app",
    dedupeKey: `app-select:${appId}`,
  });
  return json({ ok: true, freelancer, termsHash: hash, revision });
});
