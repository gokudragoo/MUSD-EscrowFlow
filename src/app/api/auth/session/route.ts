import { json, route } from "@/lib/server/http";
import { getSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const s = await getSession();
  return json({ address: s?.address ?? null });
});
