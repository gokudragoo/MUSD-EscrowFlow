import type { NextRequest } from "next/server";
import { getAddress } from "viem";
import { json, route } from "@/lib/server/http";
import { query } from "@/lib/server/db";
import { tryParseMusd } from "@/lib/money";
import { CATEGORIES } from "@/lib/validation";
import type { TermsDocument } from "@/lib/terms";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  title: string;
  summary: string;
  category: string;
  skills: string[];
  budget_wei: string;
  milestone_count: number;
  final_deadline: string;
  listing_status: string;
  client_address: string;
  chain_project_id: string | null;
  created_at: string;
  terms: TermsDocument;
  client_name: string | null;
  applications: number;
}

/** Open listings (Flow B) with search + filters. Hired listings can be included for context. */
export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const params: unknown[] = [];
  const where: string[] = [];
  const status = sp.get("status") ?? "open";
  if (status === "open") where.push(`p.listing_status = 'open'`);
  else if (status === "hired") where.push(`p.hiring_mode = 'open' and p.listing_status = 'closed' and p.freelancer_address is not null`);
  else where.push(`p.hiring_mode = 'open' and p.listing_status in ('open','closed')`);
  const q = sp.get("q")?.trim().slice(0, 80);
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(p.title) like $${params.length} or lower(p.summary) like $${params.length}
      or exists (select 1 from unnest(p.skills) s where lower(s) like $${params.length}))`);
  }
  const category = sp.get("category");
  if (category && (CATEGORIES as readonly string[]).includes(category)) {
    params.push(category);
    where.push(`p.category = $${params.length}`);
  }
  const min = tryParseMusd(sp.get("minBudget") ?? "");
  if (min !== null) {
    params.push(min.toString());
    where.push(`p.budget_wei >= $${params.length}::numeric`);
  }
  const max = tryParseMusd(sp.get("maxBudget") ?? "");
  if (max !== null) {
    params.push(max.toString());
    where.push(`p.budget_wei <= $${params.length}::numeric`);
  }
  const before = sp.get("deadlineBefore");
  if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) {
    params.push(before);
    where.push(`p.final_deadline <= ($${params.length}::date + interval '1 day')`);
  }
  const sort = sp.get("sort");
  const order =
    sort === "budget_desc" ? "p.budget_wei desc" : sort === "deadline" ? "p.final_deadline asc" : "p.created_at desc";
  const rows = await query<Row>(
    `select p.id, p.title, p.summary, p.category, p.skills, p.budget_wei::text as budget_wei, p.milestone_count, p.final_deadline,
            p.listing_status, p.client_address, p.chain_project_id::text as chain_project_id, p.created_at, p.terms,
            pr.display_name as client_name,
            (select count(*)::int from escrowflow.applications a where a.project_id = p.id) as applications
       from escrowflow.projects p left join escrowflow.profiles pr on pr.address = p.client_address
      where ${where.join(" and ")} order by ${order} limit 100`,
    params,
  );
  return json({
    listings: rows.map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      category: r.category,
      skills: r.skills,
      budgetWei: r.budget_wei,
      milestoneCount: r.milestone_count,
      milestones: r.terms.milestones.map((m) => ({ title: m.title, amount: m.amount, deadline: m.deadline })),
      finalDeadline: r.final_deadline,
      status: r.listing_status === "open" ? "Open for applications" : "Freelancer selected",
      client: getAddress(r.client_address),
      clientName: r.client_name,
      applications: r.applications,
      createdAt: r.created_at,
      rules: { autoRelease: r.terms.rules.autoRelease, deadlineReclaim: r.terms.rules.deadlineReclaim, arbiter: Boolean(r.terms.rules.arbiter) },
    })),
    categories: CATEGORIES,
  });
});
