import type { NextRequest } from "next/server";
import { z } from "zod";
import { conflict, forbidden, json, notFound, parseJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { getProjectRow } from "@/lib/server/projects";
import { audit } from "@/lib/server/records";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Open or close a marketplace listing (client only, before an escrow exists). */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  const { status } = await parseJson(req, z.object({ status: z.enum(["open", "closed"]) }));
  const row = await getProjectRow(id);
  if (!row) throw notFound("Project not found");
  if (row.client_address !== s.address.toLowerCase()) throw forbidden("Only the client can change the listing");
  if (row.chain_project_id) throw conflict("The escrow already exists on-chain");
  await query(`update escrowflow.projects set listing_status = $2, hiring_mode = case when $2 = 'open' then 'open' else hiring_mode end, updated_at = now() where id = $1`, [id, status]);
  await audit(id, s.address, status === "open" ? "listing_opened" : "listing_closed", {
    title: status === "open" ? "Listing opened to applications" : "Listing closed",
  });
  return json({ ok: true, status });
});
