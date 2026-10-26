import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { ATTACHMENT_MAX_BYTES, sniffMime } from "@/lib/validation";
import { badRequest } from "./http";
import { query } from "./db";

export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  bytes: Uint8Array;
}

export const MAX_FILES = 5;
/** Vercel functions accept ~4.5 MB request bodies; keep the whole upload below that. */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export async function readFiles(form: FormData, field = "files"): Promise<UploadedFile[]> {
  const files = form.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_FILES) throw badRequest(`Attach at most ${MAX_FILES} files`);
  const total = files.reduce((a, f) => a + f.size, 0);
  if (total > MAX_TOTAL_BYTES) throw badRequest("Attachments must total 4 MB or less per upload");
  const out: UploadedFile[] = [];
  for (const f of files) {
    if (f.size > ATTACHMENT_MAX_BYTES) throw badRequest(`${f.name} is larger than 2 MB`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime) throw badRequest(`${f.name}: only PNG, JPEG, WebP and PDF files are accepted`);
    const name = f.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "file";
    out.push({ id: randomUUID(), name, mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), bytes });
  }
  return out;
}

export async function storeFiles(projectId: string, parentKind: "submission" | "evidence", parentId: string, uploader: string, files: UploadedFile[]) {
  for (const f of files) {
    await query(
      `insert into escrowflow.attachments (id, project_id, parent_kind, parent_id, filename, mime, size_bytes, sha256, data, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [f.id, projectId, parentKind, parentId, f.name, f.mime, f.size, f.sha256, Buffer.from(f.bytes), uploader.toLowerCase()],
    );
  }
}

export async function attachmentsFor(parentKind: string, parentIds: string[]) {
  if (parentIds.length === 0) return [];
  return query<{ id: string; parent_id: string; filename: string; mime: string; size_bytes: number; sha256: string }>(
    `select id, parent_id, filename, mime, size_bytes, sha256 from escrowflow.attachments
      where parent_kind = $1 and parent_id = any($2::uuid[]) order by created_at`,
    [parentKind, parentIds],
  );
}
