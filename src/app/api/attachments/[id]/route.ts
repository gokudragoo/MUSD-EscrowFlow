import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { errorResponse, notFound } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { one } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/projects";

export const dynamic = "force-dynamic";

/** Serves an attachment only to the project's client, freelancer or arbiter. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    const s = await requireSession();
    const meta = await one<{ project_id: string }>(`select project_id from escrowflow.attachments where id = $1`, [id]);
    if (!meta) throw notFound("Attachment not found");
    await requireProjectAccess(meta.project_id, s.address, ["client", "freelancer", "arbiter"]);
    const file = await one<{ filename: string; mime: string; data: Buffer }>(
      `select filename, mime, data from escrowflow.attachments where id = $1`,
      [id],
    );
    if (!file) throw notFound("Attachment not found");
    const inline = file.mime.startsWith("image/");
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "content-type": file.mime,
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${file.filename.replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
