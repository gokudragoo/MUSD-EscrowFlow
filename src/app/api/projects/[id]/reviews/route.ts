import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { conflict, json, parseJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/projects";
import { ProjectStatus } from "@/lib/escrow-state";

export const dynamic = "force-dynamic";

/** One user-submitted review per participant per completed project (clearly labelled off-chain). */
export const POST = route(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  const { chain, access } = await requireProjectAccess(id, s.address, ["client", "freelancer"]);
  if (!chain || chain.project.status !== ProjectStatus.Completed) throw conflict("Reviews open once the project is completed on-chain");
  const body = await parseJson(req, z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().max(1500).default("") }));
  const subject = access === "client" ? chain.project.freelancer : chain.project.client;
  const rows = await query(
    `insert into escrowflow.reviews (id, project_id, reviewer, subject, rating, body) values ($1,$2,$3,$4,$5,$6)
     on conflict (project_id, reviewer) do nothing returning id`,
    [randomUUID(), id, s.address.toLowerCase(), subject.toLowerCase(), body.rating, body.body],
  );
  if (rows.length === 0) throw conflict("You already reviewed this project");
  return json({ ok: true }, { status: 201 });
});
