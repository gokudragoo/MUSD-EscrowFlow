import { json, route } from "@/lib/server/http";
import { syncChainEvents } from "@/lib/server/indexer";

export const dynamic = "force-dynamic";

/** Pulls new EscrowFlow events into the cache (idempotent; anyone may trigger it). */
export const POST = route(async () => {
  const r = await syncChainEvents();
  return json({ ...r, from: r.from.toString(), to: r.to.toString() });
});
