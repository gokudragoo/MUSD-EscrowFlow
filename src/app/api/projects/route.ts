import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { badRequest, json, parseJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query, transaction } from "@/lib/server/db";
import { readProjects } from "@/lib/server/chain";
import { PROJECT_COLUMNS, type ProjectRow } from "@/lib/server/projects";
import { buildTermsDocument, draftInputSchema } from "@/lib/validation";
import { hashTerms, validateTermsDocument } from "@/lib/terms";
import { ledgerOf, PROJECT_STATUS_LABEL } from "@/lib/escrow-state";

export const dynamic = "force-dynamic";

/** Create an agreement draft (Flow A direct hire) or an open marketplace listing (Flow B). */
export const POST = route(async (req: NextRequest) => {
  const s = await requireSession();
  const draft = await parseJson(req, draftInputSchema);
  if (draft.freelancer && draft.freelancer === s.address) throw badRequest("You cannot hire your own wallet");
  if (draft.rules.arbiter && draft.rules.arbiter === s.address) throw badRequest("The arbiter must be a third party");
  const terms = buildTermsDocument(draft, s.address, draft.hiringMode === "open" ? null : draft.freelancer);
  const problems = validateTermsDocument(terms).filter((p) => !(draft.hiringMode === "open" && p.includes("Freelancer")));
  if (problems.length) throw badRequest(problems[0], problems);
  const hash = hashTerms(terms);
  const id = randomUUID();
  const finalDeadline = new Date(Math.max(...terms.milestones.map((m) => m.deadline)) * 1000);
  await transaction([
    {
      text: `insert into escrowflow.projects (id, client_address, freelancer_address, title, summary, category, skills, budget_wei,
               milestone_count, final_deadline, hiring_mode, listing_status, terms, terms_hash)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      params: [
        id,
        s.address.toLowerCase(),
        draft.hiringMode === "direct" ? draft.freelancer!.toLowerCase() : null,
        draft.title,
        draft.summary,
        draft.category,
        draft.skills,
        terms.totalAmount,
        terms.milestones.length,
        finalDeadline,
        draft.hiringMode,
        draft.hiringMode === "open" ? "open" : "draft",
        JSON.stringify(terms),
        hash,
      ],
    },
    {
      text: `insert into escrowflow.terms_revisions (project_id, revision, terms, terms_hash, author, note) values ($1, 1, $2, $3, $4, $5)`,
      params: [id, JSON.stringify(terms), hash, s.address.toLowerCase(), "Initial draft"],
    },
    {
      text: `insert into escrowflow.audit_events (project_id, actor, action, detail) values ($1,$2,'project_created',$3)`,
      params: [
        id,
        s.address.toLowerCase(),
        JSON.stringify({
          title: draft.hiringMode === "open" ? "Listing published" : "Agreement draft created",
          summary: `${terms.milestones.length} milestones · terms hash ${hash.slice(0, 10)}…`,
        }),
      ],
    },
  ]);
  return json({ id, termsHash: hash }, { status: 201 });
});

/** Projects where the signed-in wallet is client, freelancer, or applicant — with live chain status. */
export const GET = route(async () => {
  const s = await requireSession();
  const me = s.address.toLowerCase();
  const rows = await query<ProjectRow & { applied: boolean }>(
    `select ${PROJECT_COLUMNS}, exists(select 1 from escrowflow.applications a where a.project_id = p.id and a.freelancer_address = $1) as applied
       from escrowflow.projects p
      where client_address = $1 or freelancer_address = $1
         or exists(select 1 from escrowflow.applications a where a.project_id = p.id and a.freelancer_address = $1)
      order by updated_at desc limit 200`,
    [me],
  );
  const linked = rows.filter((r) => r.chain_project_id).map((r) => BigInt(r.chain_project_id!));
  const snaps = await readProjects(linked).catch(() => []);
  const byId = new Map(snaps.map((x) => [x.id.toString(), x]));
  return json({
    projects: rows.map((r) => {
      const snap = r.chain_project_id ? byId.get(r.chain_project_id) : undefined;
      return {
        id: r.id,
        title: r.title,
        category: r.category,
        budgetWei: r.budget_wei,
        milestoneCount: r.milestone_count,
        finalDeadline: r.final_deadline,
        hiringMode: r.hiring_mode,
        listingStatus: r.listing_status,
        role: r.client_address === me ? "client" : r.freelancer_address === me ? "freelancer" : "applicant",
        chainProjectId: r.chain_project_id,
        chainStatus: snap ? snap.project.status : null,
        chainStatusLabel: snap ? PROJECT_STATUS_LABEL[snap.project.status] : r.listing_status === "open" ? "Open listing" : "Draft (off-chain)",
        ledger: snap ? ledgerOf(snap.project) : null,
        milestoneStatuses: snap ? snap.milestones.map((m) => m.status) : null,
        milestoneAmounts: snap ? snap.milestones.map((m) => m.amount) : r.terms.milestones.map((m) => m.amount),
        updatedAt: r.updated_at,
      };
    }),
  });
});
