import { after, type NextRequest } from "next/server";
import { badRequest, conflict, forbidden, json, notFound, parseJson, route } from "@/lib/server/http";
import { getSession, requireSession } from "@/lib/server/auth";
import { one, transaction } from "@/lib/server/db";
import { readProject } from "@/lib/server/chain";
import { getProjectRow, projectView } from "@/lib/server/projects";
import { syncIfStale } from "@/lib/server/indexer";
import { buildTermsDocument, draftInputSchema } from "@/lib/validation";
import { hashTerms, validateTermsDocument } from "@/lib/terms";
import { ProjectStatus } from "@/lib/escrow-state";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const row = await getProjectRow(id);
  if (!row) throw notFound("Project not found");
  after(() => syncIfStale());
  const session = await getSession();
  return json(await projectView(row, session?.address ?? null));
});

/**
 * Edit terms before funding (client only). Appends a new revision; if the escrow already exists
 * on-chain the client must then commit it with updateTerms (which resets the freelancer's acceptance).
 */
export const PUT = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  const row = await getProjectRow(id);
  if (!row) throw notFound("Project not found");
  if (row.client_address !== s.address.toLowerCase()) throw forbidden("Only the client can edit the terms");
  if (row.chain_project_id) {
    const snap = await readProject(BigInt(row.chain_project_id));
    if (snap && snap.project.status !== ProjectStatus.AwaitingAcceptance && snap.project.status !== ProjectStatus.AwaitingFunding) {
      throw conflict("Terms are locked after funding. Use the dispute or cancellation process instead.");
    }
  }
  const draft = await parseJson(req, draftInputSchema);
  if (draft.freelancer && draft.freelancer === s.address) throw badRequest("You cannot hire your own wallet");
  const freelancer = draft.freelancer ?? (row.freelancer_address as `0x${string}` | null);
  const terms = buildTermsDocument(draft, s.address, freelancer);
  const problems = validateTermsDocument(terms).filter((p) => !(!freelancer && p.includes("Freelancer")));
  if (problems.length) throw badRequest(problems[0], problems);
  const hash = hashTerms(terms);
  if (hash === row.terms_hash) return json({ id, termsHash: hash, unchanged: true });
  const last = await one<{ revision: number }>(`select max(revision) as revision from escrowflow.terms_revisions where project_id = $1`, [id]);
  const revision = (last?.revision ?? 0) + 1;
  const finalDeadline = new Date(Math.max(...terms.milestones.map((m) => m.deadline)) * 1000);
  await transaction([
    {
      text: `update escrowflow.projects set title=$2, summary=$3, category=$4, skills=$5, budget_wei=$6, milestone_count=$7,
               final_deadline=$8, terms=$9, terms_hash=$10, freelancer_address=$11, updated_at=now() where id=$1`,
      params: [
        id,
        draft.title,
        draft.summary,
        draft.category,
        draft.skills,
        terms.totalAmount,
        terms.milestones.length,
        finalDeadline,
        JSON.stringify(terms),
        hash,
        freelancer ? freelancer.toLowerCase() : null,
      ],
    },
    {
      text: `insert into escrowflow.terms_revisions (project_id, revision, terms, terms_hash, author, note) values ($1,$2,$3,$4,$5,$6)`,
      params: [id, revision, JSON.stringify(terms), hash, s.address.toLowerCase(), `Revision ${revision}`],
    },
    {
      text: `insert into escrowflow.audit_events (project_id, actor, action, detail) values ($1,$2,'terms_edited',$3)`,
      params: [
        id,
        s.address.toLowerCase(),
        JSON.stringify({
          title: `Terms draft revised (revision ${revision})`,
          summary: row.chain_project_id ? "Needs to be committed on-chain; the freelancer must accept again." : `New terms hash ${hash.slice(0, 10)}…`,
        }),
      ],
    },
  ]);
  return json({ id, termsHash: hash, revision, needsOnchainUpdate: Boolean(row.chain_project_id) });
});
