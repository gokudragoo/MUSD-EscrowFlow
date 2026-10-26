import { after, type NextRequest } from "next/server";
import { json, notFound, route } from "@/lib/server/http";
import { readProject } from "@/lib/server/chain";
import { getProjectRowByChainId, serializeChain, chainEventsFor, chainEventTitle } from "@/lib/server/projects";
import { syncIfStale } from "@/lib/server/indexer";

export const dynamic = "force-dynamic";

/** Public on-chain view of an escrow by contract project id (facts only, no private terms). */
export const GET = route(async (_req: NextRequest, ctx: { params: Promise<{ chainId: string }> }) => {
  const { chainId } = await ctx.params;
  if (!/^\d{1,12}$/.test(chainId)) throw notFound("Unknown escrow");
  const snap = await readProject(BigInt(chainId));
  if (!snap) throw notFound("Unknown escrow");
  after(() => syncIfStale());
  const row = await getProjectRowByChainId(BigInt(chainId));
  const events = await chainEventsFor([chainId]);
  return json({
    chain: serializeChain(snap),
    linkedProjectId: row?.id ?? null,
    events: events.map((e) => ({ ...e, title: chainEventTitle(e.event_name) })),
  });
});
