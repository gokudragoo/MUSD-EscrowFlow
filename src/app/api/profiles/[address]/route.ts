import { isAddress, getAddress } from "viem";
import { after, type NextRequest } from "next/server";
import { json, notFound, route } from "@/lib/server/http";
import { getProfile, onchainHistory } from "@/lib/server/profiles";
import { query } from "@/lib/server/db";
import { syncIfStale } from "@/lib/server/indexer";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: NextRequest, ctx: { params: Promise<{ address: string }> }) => {
  const { address } = await ctx.params;
  if (!isAddress(address)) throw notFound("Unknown wallet address");
  const addr = getAddress(address);
  after(() => syncIfStale());
  const [profile, history, reviews] = await Promise.all([
    getProfile(addr),
    onchainHistory(addr),
    query<{ rating: number; body: string; reviewer: string; created_at: string; project_id: string }>(
      `select rating, body, reviewer, created_at, project_id from escrowflow.reviews where subject = $1 order by created_at desc limit 20`,
      [addr.toLowerCase()],
    ),
  ]);
  if (profile) delete (profile as Record<string, unknown>).notificationPrefs;
  return json({ address: addr, profile, history, reviews });
});
