import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getAddress } from "viem";
import { badRequest, forbidden, json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { requireProjectAccess } from "@/lib/server/projects";
import { attachmentsFor, readFiles, storeFiles, type UploadedFile } from "@/lib/server/uploads";
import { audit, notify } from "@/lib/server/records";
import { hashNote, NOTE_SCHEMA, type NoteRecord } from "@/lib/terms";
import { noteInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Review comments, change-request reasons, dispute reasons and evidence (parties + arbiter only). */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  await requireProjectAccess(id, s.address, ["client", "freelancer", "arbiter"]);
  const rows = await query<{ id: string; milestone_index: number | null; author: string; kind: string; body: string; links: string[]; note_hash: string | null; tx_hash: string | null; created_at: string }>(
    `select id, milestone_index, author, kind, body, links, note_hash, tx_hash, created_at from escrowflow.comments where project_id = $1 order by created_at asc`,
    [id],
  );
  const files = await attachmentsFor("evidence", rows.map((r) => r.id));
  return json({
    notes: rows.map((r) => ({
      id: r.id,
      milestoneIndex: r.milestone_index,
      author: getAddress(r.author),
      kind: r.kind,
      body: r.body,
      links: r.links,
      noteHash: r.note_hash,
      txHash: r.tx_hash,
      createdAt: r.created_at,
      attachments: files
        .filter((f) => f.parent_id === r.id)
        .map((f) => ({ id: f.id, name: f.filename, mime: f.mime, size: f.size_bytes, url: `/api/attachments/${f.id}` })),
    })),
  });
});

export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  const { row, chain, access } = await requireProjectAccess(id, s.address, ["client", "freelancer", "arbiter"]);
  let input: unknown;
  let files: UploadedFile[] = [];
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const mi = form.get("milestoneIndex");
    input = {
      kind: form.get("kind"),
      milestoneIndex: mi === null || mi === "" ? null : Number(mi),
      body: form.get("body"),
      links: JSON.parse(String(form.get("links") ?? "[]")),
    };
    files = await readFiles(form);
  } else {
    input = await req.json().catch(() => {
      throw badRequest("Request body must be valid JSON");
    });
  }
  const note = noteInputSchema.parse(input);
  if (note.kind === "change_request" && access !== "client") throw forbidden("Only the client can request changes");
  if (note.kind === "dispute" && access === "arbiter") throw forbidden("Only the client or freelancer can open a dispute");
  if ((note.kind === "change_request" || note.kind === "dispute") && note.milestoneIndex === null) throw badRequest("Choose a milestone");
  if (files.length && note.kind !== "evidence") throw badRequest("Attachments are only accepted as dispute evidence");

  let noteHash: string | null = null;
  let record: NoteRecord | null = null;
  if ((note.kind === "change_request" || note.kind === "dispute") && chain) {
    record = {
      schema: NOTE_SCHEMA,
      kind: note.kind,
      chainProjectId: chain.id.toString(),
      milestoneIndex: note.milestoneIndex!,
      author: getAddress(s.address),
      body: note.body,
      createdAt: new Date().toISOString(),
    };
    noteHash = hashNote(record);
  }
  const noteId = randomUUID();
  await query(
    `insert into escrowflow.comments (id, project_id, milestone_index, author, kind, body, links, note_hash, record) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [noteId, row.id, note.milestoneIndex, s.address.toLowerCase(), note.kind, note.body, JSON.stringify(note.links), noteHash, record ? JSON.stringify(record) : null],
  );
  if (files.length) await storeFiles(row.id, "evidence", noteId, s.address, files);
  const label = { comment: "Comment", change_request: "Change request note", dispute: "Dispute reason", evidence: "Dispute evidence" }[note.kind];
  await audit(row.id, s.address, `note_${note.kind}`, {
    title: `${label} added${note.milestoneIndex !== null ? ` on milestone ${note.milestoneIndex + 1}` : ""}`,
    summary: note.body.slice(0, 160),
    milestoneIndex: note.milestoneIndex,
  });
  // Off-chain notes notify the other parties directly; on-chain actions notify via verified events.
  if (note.kind === "comment" || note.kind === "evidence") {
    const recipients = [chain?.project.client ?? row.client_address, chain?.project.freelancer ?? row.freelancer_address]
      .filter(Boolean)
      .map((a) => a!.toLowerCase())
      .filter((a) => a !== s.address.toLowerCase());
    for (const r of recipients) {
      await notify({
        recipient: r,
        kind: note.kind === "evidence" ? "dispute" : "comment",
        title: `${label} on ${row.title}`,
        body: note.body.slice(0, 140),
        href: `/projects/${row.id}`,
        source: "app",
        dedupeKey: `note:${noteId}:${r}`,
      });
    }
  }
  return json({ id: noteId, noteHash, record }, { status: 201 });
});
