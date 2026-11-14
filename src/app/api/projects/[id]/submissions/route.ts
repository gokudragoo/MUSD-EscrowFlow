import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAddress } from "viem";
import { badRequest, conflict, json, route, readForm } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/projects";
import { attachmentsFor, readFiles, storeFiles } from "@/lib/server/uploads";
import { audit } from "@/lib/server/records";
import { hashSubmission, SUBMISSION_SCHEMA, type SubmissionRecord } from "@/lib/terms";
import { MilestoneStatus, ProjectStatus } from "@/lib/escrow-state";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const fieldsSchema = z.object({
  // A missing field must not silently become milestone 0.
  milestoneIndex: z.string().regex(/^\d{1,2}$/, "Choose a milestone").transform(Number).pipe(z.number().int().min(0).max(19)),
  description: z.string().trim().min(10, "Describe what you delivered (10+ characters)").max(5000),
  links: z
    .array(z.string().trim().url().max(500).refine((u) => /^https?:\/\//.test(u), "Links must start with https://"))
    .max(10),
});

/** Submission history for a project (parties + arbiter only). */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  await requireProjectAccess(id, s.address, ["client", "freelancer", "arbiter"]);
  const rows = await query<{ id: string; milestone_index: number; record: SubmissionRecord; submission_hash: string; tx_hash: string | null; created_at: string }>(
    `select id, milestone_index, record, submission_hash, tx_hash, created_at from escrowflow.submissions where project_id = $1 order by created_at desc`,
    [id],
  );
  const files = await attachmentsFor("submission", rows.map((r) => r.id));
  return json({
    submissions: rows.map((r) => ({
      id: r.id,
      milestoneIndex: r.milestone_index,
      description: r.record.description,
      links: r.record.links,
      submissionHash: r.submission_hash,
      txHash: r.tx_hash,
      onchain: Boolean(r.tx_hash),
      createdAt: r.created_at,
      attachments: files
        .filter((f) => f.parent_id === r.id)
        .map((f) => ({ id: f.id, name: f.filename, mime: f.mime, size: f.size_bytes, sha256: f.sha256, url: `/api/attachments/${f.id}` })),
    })),
  });
});

/**
 * Freelancer stores the submission record (application record) and receives the hash to commit
 * on-chain with submitMilestone. The record is only "submitted" once that tx is verified.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  const { row, chain } = await requireProjectAccess(id, s.address, ["freelancer"]);
  if (!chain || chain.project.status !== ProjectStatus.Active) throw conflict("Work can be submitted once the escrow is funded");
  if (chain.project.freelancer !== s.address) throw badRequest("Only the escrow's freelancer can submit");
  const form = await readForm(req);
  let links: unknown = [];
  try {
    links = JSON.parse(String(form.get("links") ?? "[]"));
  } catch {
    throw badRequest("Links must be a JSON array");
  }
  const fields = fieldsSchema.parse({ milestoneIndex: form.get("milestoneIndex"), description: form.get("description"), links });
  const m = chain.milestones[fields.milestoneIndex];
  if (!m) throw badRequest("Unknown milestone");
  if (m.status !== MilestoneStatus.Pending && m.status !== MilestoneStatus.ChangesRequested) {
    throw conflict("This milestone is not open for submission");
  }
  const files = await readFiles(form);
  const record: SubmissionRecord = {
    schema: SUBMISSION_SCHEMA,
    chainProjectId: chain.id.toString(),
    milestoneIndex: fields.milestoneIndex,
    freelancer: getAddress(s.address),
    description: fields.description,
    links: fields.links,
    attachments: files.map((f) => ({ name: f.name, mime: f.mime, size: f.size, sha256: f.sha256 })),
    createdAt: new Date().toISOString(),
  };
  const submissionHash = hashSubmission(record);
  const subId = randomUUID();
  await query(
    `insert into escrowflow.submissions (id, project_id, milestone_index, freelancer_address, record, submission_hash)
     values ($1,$2,$3,$4,$5,$6)`,
    [subId, row.id, fields.milestoneIndex, s.address.toLowerCase(), JSON.stringify(record), submissionHash],
  );
  await storeFiles(row.id, "submission", subId, s.address, files);
  await audit(row.id, s.address, "submission_recorded", {
    title: `Submission prepared for milestone ${fields.milestoneIndex + 1}`,
    summary: `${fields.links.length} links · ${files.length} attachments · hash ${submissionHash.slice(0, 10)}…`,
    milestoneIndex: fields.milestoneIndex,
  });
  return json({ id: subId, submissionHash, record }, { status: 201 });
});
