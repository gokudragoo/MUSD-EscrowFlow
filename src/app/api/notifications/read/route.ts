import type { NextRequest } from "next/server";
import { z } from "zod";
import { json, parseJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export const POST = route(async (req: NextRequest) => {
  const s = await requireSession();
  const body = await parseJson(req, z.object({ ids: z.array(z.string().uuid()).max(200).optional(), all: z.boolean().optional() }));
  if (body.all) {
    await query(`update escrowflow.notifications set read_at = now() where recipient = $1 and read_at is null`, [s.address.toLowerCase()]);
  } else if (body.ids?.length) {
    await query(`update escrowflow.notifications set read_at = now() where recipient = $1 and id = any($2::uuid[]) and read_at is null`, [
      s.address.toLowerCase(),
      body.ids,
    ]);
  }
  return json({ ok: true });
});
