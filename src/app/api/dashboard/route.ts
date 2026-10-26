import { after } from "next/server";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { buildDashboard } from "@/lib/server/dashboard";
import { syncIfStale } from "@/lib/server/indexer";
import { query } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const s = await requireSession();
  after(() => syncIfStale());
  const [data, drafts] = await Promise.all([
    buildDashboard(s.address),
    query<{ id: string; title: string; budget_wei: string; listing_status: string; hiring_mode: string; updated_at: string; applications: number }>(
      `select p.id, p.title, p.budget_wei::text as budget_wei, p.listing_status, p.hiring_mode, p.updated_at,
              (select count(*)::int from escrowflow.applications a where a.project_id = p.id and a.status = 'submitted') as applications
         from escrowflow.projects p where p.client_address = $1 and p.chain_project_id is null order by p.updated_at desc limit 20`,
      [s.address.toLowerCase()],
    ),
  ]);
  return json({ ...data, drafts });
});
