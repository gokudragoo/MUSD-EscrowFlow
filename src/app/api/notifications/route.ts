import { after } from "next/server";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { syncIfStale } from "@/lib/server/indexer";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const s = await requireSession();
  after(() => syncIfStale());
  const rows = await query<{
    id: string;
    kind: string;
    title: string;
    body: string;
    href: string | null;
    source: string;
    tx_hash: string | null;
    read_at: string | null;
    created_at: string;
  }>(
    `select id, kind, title, body, href, source, tx_hash, read_at, created_at from escrowflow.notifications
      where recipient = $1 order by created_at desc limit 100`,
    [s.address.toLowerCase()],
  );
  return json({ notifications: rows, unread: rows.filter((r) => !r.read_at).length });
});
