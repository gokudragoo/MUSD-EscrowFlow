import "server-only";
import { randomUUID } from "node:crypto";
import { query } from "./db";

export interface NotifyInput {
  recipient: string;
  kind: string;
  title: string;
  body?: string;
  href?: string | null;
  source: "chain" | "app" | "reminder";
  txHash?: string | null;
  dedupeKey: string;
}

/** Inserts a notification once (dedupe_key is UNIQUE). */
export async function notify(n: NotifyInput) {
  await query(
    `insert into escrowflow.notifications (id, recipient, kind, title, body, href, source, tx_hash, dedupe_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (dedupe_key) do nothing`,
    [randomUUID(), n.recipient.toLowerCase(), n.kind, n.title, n.body ?? "", n.href ?? null, n.source, n.txHash ?? null, n.dedupeKey],
  );
}

/** Application-record audit trail entry (never used for money state). */
export async function audit(projectId: string | null, actor: string, action: string, detail: Record<string, unknown> = {}) {
  await query(`insert into escrowflow.audit_events (project_id, actor, action, detail) values ($1,$2,$3,$4)`, [
    projectId,
    actor.toLowerCase(),
    action,
    JSON.stringify(detail),
  ]);
}
