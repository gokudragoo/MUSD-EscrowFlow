import type { NextRequest } from "next/server";
import { json, route } from "@/lib/server/http";
import { listProfiles } from "@/lib/server/profiles";

export const dynamic = "force-dynamic";

export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const profiles = await listProfiles({
    q: sp.get("q")?.slice(0, 80) || undefined,
    role: sp.get("role") ?? "freelancer",
    skill: sp.get("skill")?.slice(0, 40) || undefined,
  });
  return json({ profiles });
});
