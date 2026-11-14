import { json, route, badRequest, readForm } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { AVATAR_MAX_BYTES, sniffMime } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const s = await requireSession();
  const form = await readForm(req, 600_000);
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Attach an image file");
  if (file.size > AVATAR_MAX_BYTES) throw badRequest("Profile images must be 512 KB or smaller");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime || mime === "application/pdf") throw badRequest("Use a PNG, JPEG or WebP image");
  const res = await query(
    `update escrowflow.profiles set avatar_mime = $2, avatar_data = $3, updated_at = now() where address = $1 returning address`,
    [s.address.toLowerCase(), mime, Buffer.from(bytes)],
  );
  if (res.length === 0) throw badRequest("Create your profile before adding an image");
  return json({ ok: true });
});

export const DELETE = route(async () => {
  const s = await requireSession();
  await query(`update escrowflow.profiles set avatar_mime = null, avatar_data = null, updated_at = now() where address = $1`, [
    s.address.toLowerCase(),
  ]);
  return json({ ok: true });
});
