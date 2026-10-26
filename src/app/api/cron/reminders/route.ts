import type { NextRequest } from "next/server";
import { json, errorResponse, unauthorized } from "@/lib/server/http";
import { query } from "@/lib/server/db";
import { readProjects } from "@/lib/server/chain";
import { syncChainEvents } from "@/lib/server/indexer";
import { notify } from "@/lib/server/records";
import { serverEnv } from "@/lib/server/env";
import { MilestoneStatus, ProjectStatus, reviewDeadlineOf } from "@/lib/escrow-state";
import type { TermsDocument } from "@/lib/terms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily reminder job (Vercel Cron, once per day on Hobby). Sends REMINDERS ONLY — it never moves
 * funds. Deadlines are read from the contract, not the database.
 */
export async function GET(req: NextRequest) {
  try {
    const secret = serverEnv.cronSecret();
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) throw unauthorized("Invalid cron secret");
    const sync = await syncChainEvents(12);
    const rows = await query<{ id: string; title: string; chain_project_id: string; terms: TermsDocument }>(
      `select id, title, chain_project_id::text as chain_project_id, terms from escrowflow.projects where chain_project_id is not null`,
    );
    const snaps = await readProjects(rows.map((r) => BigInt(r.chain_project_id)));
    const now = Math.floor(Date.now() / 1000);
    const day = new Date().toISOString().slice(0, 10);
    let sent = 0;
    for (const snap of snaps) {
      if (snap.project.status !== ProjectStatus.Active) continue;
      const row = rows.find((r) => r.chain_project_id === snap.id.toString())!;
      const href = `/projects/${row.id}`;
      for (const [i, m] of snap.milestones.entries()) {
        const label = `M${i + 1} · ${row.terms.milestones[i]?.title ?? "Milestone"}`;
        const deadline = Number(m.deadline);
        if ((m.status === MilestoneStatus.Pending || m.status === MilestoneStatus.ChangesRequested) && deadline > now && deadline - now <= 2 * 86_400) {
          for (const to of [snap.project.freelancer, snap.project.client]) {
            await notify({ recipient: to, kind: "deadline", title: `Deadline approaching: ${label}`, body: `${row.title} · due ${new Date(deadline * 1000).toUTCString()}`, href, source: "reminder", dedupeKey: `rem:due:${snap.id}:${i}:${day}:${to}` });
            sent++;
          }
        }
        if ((m.status === MilestoneStatus.Pending || m.status === MilestoneStatus.ChangesRequested) && deadline <= now) {
          for (const to of [snap.project.freelancer, snap.project.client]) {
            await notify({ recipient: to, kind: "deadline", title: `Milestone overdue: ${label}`, body: `${row.title} · deadline passed ${new Date(deadline * 1000).toUTCString()}`, href, source: "reminder", dedupeKey: `rem:overdue:${snap.id}:${i}:${day}:${to}` });
            sent++;
          }
        }
        if (m.status === MilestoneStatus.Submitted) {
          const end = reviewDeadlineOf(m);
          if (end > now && end - now <= 86_400) {
            await notify({ recipient: snap.project.client, kind: "review", title: `Review period ends soon: ${label}`, body: `${row.title} · ends ${new Date(end * 1000).toUTCString()}`, href, source: "reminder", dedupeKey: `rem:review:${snap.id}:${i}:${day}` });
            sent++;
          } else if (end <= now) {
            await notify({
              recipient: snap.project.freelancer,
              kind: "review",
              title: `Review period elapsed: ${label}`,
              body: snap.project.autoRelease ? "The agreed terms let you claim this milestone now." : "The client has not responded. You can message them or open a dispute.",
              href,
              source: "reminder",
              dedupeKey: `rem:review-elapsed:${snap.id}:${i}:${day}`,
            });
            sent++;
          }
        }
      }
    }
    return json({ ok: true, sync: { ...sync, from: sync.from.toString(), to: sync.to.toString() }, remindersQueued: sent });
  } catch (e) {
    return errorResponse(e);
  }
}
