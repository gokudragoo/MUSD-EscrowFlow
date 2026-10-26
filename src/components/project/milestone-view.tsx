"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Paperclip, FileWarning, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Field, Notice, PageHeader, Panel, PanelHeader, Skeleton, Textarea } from "@/components/ui/primitives";
import { Amount, HashText, SourceTag, TxLink } from "@/components/ui/chain";
import { KeyValue, MilestonePill, Timeline } from "@/components/escrow/escrow-ui";
import { MilestoneActionBar } from "./actions";
import { useNotes, useProject, useSubmissions } from "@/hooks/useProject";
import { useNow } from "@/hooks/useClient";
import { api } from "@/lib/client/api";
import { MilestoneStatus, milestoneDisplay, reclaimAvailableAt, reviewDeadlineOf } from "@/lib/escrow-state";
import { countdown, formatDate, formatDuration } from "@/lib/utils";
import { formatMusd } from "@/lib/money";

const ZERO = "0x0000000000000000000000000000000000000000";

export function MilestoneView({ id, index, focus }: { id: string; index: number; focus?: "review" }) {
  const { address } = useAccount();
  const { view, chain, isLoading } = useProject(id);
  const isParty = view && (view.access === "client" || view.access === "freelancer" || view.access === "arbiter");
  const subs = useSubmissions(id, !!isParty);
  const notes = useNotes(id, !!isParty);
  const now = useNow(10_000);
  if (isLoading) return <Skeleton className="h-96" />;
  if (!view || view.private) return <Notice tone="warning" title="This milestone is visible to project participants only" />;
  const t = view.terms?.milestones[index];
  const m = chain?.milestones[index];
  if (!t && !m) return <Notice tone="danger" title="Milestone not found" />;
  const display = milestoneDisplay(chain?.project ?? null, m ?? null);
  const mySubs = (subs.data?.submissions ?? []).filter((s) => s.milestoneIndex === index);
  const latest = mySubs.find((s) => m && s.submissionHash.toLowerCase() === m.submissionHash.toLowerCase()) ?? mySubs[0];
  const myNotes = (notes.data?.notes ?? []).filter((n) => n.milestoneIndex === index);
  const events = (view.timeline ?? []).filter((e) => e.milestoneIndex === index);

  return (
    <div>
      <Link href={`/projects/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] text-mist-300 hover:text-white">
        <ArrowLeft className="size-4" /> {view.project.title}
      </Link>
      <PageHeader
        eyebrow={`Milestone ${index + 1} of ${view.terms?.milestones.length ?? chain?.milestones.length}`}
        title={t?.title ?? `Milestone ${index + 1}`}
        actions={
          <>
            <MilestonePill display={display} />
            <Amount wei={m?.amount ?? t?.amount ?? "0"} className="text-[20px] font-semibold text-white" />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {chain && m && (
            <Panel raised className={focus === "review" ? "border-signal-400/40" : ""}>
              <PanelHeader title={view.access === "client" ? "Review controls" : view.access === "freelancer" ? "Your actions" : "Actions"} description="Every action here is a wallet transaction checked by the contract." />
              <div className="space-y-3 p-5">
                {m.status === MilestoneStatus.Submitted && (
                  <Notice tone={now >= reviewDeadlineOf(m) ? "warning" : "info"}>
                    {now >= reviewDeadlineOf(m)
                      ? `The review period ended ${formatDate(reviewDeadlineOf(m), true)}.${chain.project.autoRelease ? " Under the agreed terms the freelancer may now claim this milestone." : " Auto-release is not part of these terms; the freelancer can message the client or open a dispute."}`
                      : `Review period ends in ${countdown(reviewDeadlineOf(m))} (${formatDate(reviewDeadlineOf(m), true)}). Approve, request changes or open a dispute before then.`}
                  </Notice>
                )}
                {m.status === MilestoneStatus.Disputed && (
                  <Notice tone="warning" icon={<ShieldAlert className="size-4" />} title="Disputed — funds frozen">
                    Opened by {m.disputeInitiator.toLowerCase() === address?.toLowerCase() ? "you" : m.disputeInitiator === chain.project.client ? "the client" : "the freelancer"} on {formatDate(Number(m.disputedAt), true)}.{" "}
                    {m.settlementProposer !== ZERO
                      ? `Standing proposal: ${formatMusd(m.proposedFreelancerAmount)} MUSD to the freelancer, ${formatMusd(m.amount - m.proposedFreelancerAmount)} MUSD to the client.`
                      : "No split proposed yet."}
                  </Notice>
                )}
                <MilestoneActionBar view={view} chain={chain} index={index} who={address} />
                {m.status === MilestoneStatus.Released && <Notice tone="success" icon={<ShieldCheck className="size-4" />} title={`Paid: ${formatMusd(m.releasedAmount)} MUSD`}>Verified from contract state; see the payment transaction in the history below.</Notice>}
                {m.status === MilestoneStatus.Refunded && <Notice title={`Refunded to the client: ${formatMusd(m.refundedAmount)} MUSD`} />}
                {m.status === MilestoneStatus.Resolved && <Notice title={`Resolved: ${formatMusd(m.releasedAmount)} MUSD to the freelancer, ${formatMusd(m.refundedAmount)} MUSD to the client`} />}
              </div>
            </Panel>
          )}

          <Panel>
            <PanelHeader title="Latest submission" description="Submissions are application records; their hash is committed on-chain when submitted. Content is checked by the client, not by the app." />
            <div className="p-5">
              {!isParty ? (
                <p className="text-[14px] text-mist-400">Visible to participants only.</p>
              ) : subs.isLoading ? (
                <Skeleton className="h-24" />
              ) : latest ? (
                <SubmissionCard s={latest} onchainHash={m?.submissionHash} />
              ) : (
                <EmptyState icon={<Paperclip className="size-5" />} title="Nothing submitted yet" description="When the freelancer submits, the deliverables appear here for review." />
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Acceptance criteria" />
            <div className="space-y-4 p-5 text-[14px]">
              {t?.description && <p className="whitespace-pre-line text-mist-200">{t.description}</p>}
              {t && t.deliverables.length > 0 && (
                <div>
                  <div className="text-[12.5px] font-medium text-mist-400">Deliverables</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-mist-100">
                    {t.deliverables.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <div className="text-[12.5px] font-medium text-mist-400">Accepted when</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-mist-100">
                  {(t?.acceptanceCriteria ?? []).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>

          {isParty && (
            <Panel>
              <PanelHeader title="Discussion and evidence" description="Private to the client, freelancer and arbiter. Labelled application records — not on-chain facts." />
              <NotesThread id={id} index={index} notes={myNotes} disputed={m?.status === MilestoneStatus.Disputed} />
            </Panel>
          )}

          {isParty && mySubs.length > 1 && (
            <Panel>
              <PanelHeader title="Submission history" />
              <div className="space-y-4 p-5">
                {mySubs.slice(1).map((s) => (
                  <SubmissionCard key={s.id} s={s} onchainHash={m?.submissionHash} />
                ))}
              </div>
            </Panel>
          )}

          <Panel>
            <PanelHeader title="Milestone history" />
            <Timeline items={events} />
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel>
            <PanelHeader title="Payment terms" />
            <dl className="divide-y divide-ink-700 px-5 text-[13.5px]">
              <KeyValue label="Amount">
                <Amount wei={m?.amount ?? t?.amount ?? "0"} />
              </KeyValue>
              <KeyValue label="Deadline">{formatDate(Number(m?.deadline ?? t?.deadline ?? 0), true)}</KeyValue>
              <KeyValue label="Review period">{formatDuration(m?.reviewPeriod ?? t?.reviewPeriodSeconds ?? 0)}</KeyValue>
              {m && <KeyValue label="Submissions">{m.revision}</KeyValue>}
              {m && m.status === MilestoneStatus.Submitted && <KeyValue label="Review ends">{formatDate(reviewDeadlineOf(m), true)}</KeyValue>}
              {m && chain?.project.deadlineReclaim && (m.status === MilestoneStatus.Pending || m.status === MilestoneStatus.ChangesRequested) && (
                <KeyValue label="Client may reclaim after">{formatDate(reclaimAvailableAt(chain.project, m), true)}</KeyValue>
              )}
              {m && <KeyValue label="Paid to freelancer"><Amount wei={m.releasedAmount} /></KeyValue>}
              {m && <KeyValue label="Returned to client"><Amount wei={m.refundedAmount} /></KeyValue>}
              {m && m.submissionHash !== "0x0000000000000000000000000000000000000000000000000000000000000000" && (
                <KeyValue label="On-chain submission hash">
                  <HashText value={m.submissionHash} />
                </KeyValue>
              )}
            </dl>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function SubmissionCard({ s, onchainHash }: { s: import("@/lib/client/types").Submission; onchainHash?: string }) {
  const committed = !!onchainHash && onchainHash.toLowerCase() === s.submissionHash.toLowerCase();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-mist-400">
        <SourceTag source="app" />
        <span>{formatDate(s.createdAt, true)}</span>
        {s.txHash ? (
          <Badge tone="released">Hash committed on-chain</Badge>
        ) : committed ? (
          <Badge tone="released">Matches on-chain hash</Badge>
        ) : (
          <Badge tone="warning">Not submitted on-chain</Badge>
        )}
        {s.txHash && <TxLink hash={s.txHash} />}
      </div>
      <p className="whitespace-pre-line text-[14px] leading-relaxed text-mist-100">{s.description}</p>
      {s.links.length > 0 && (
        <ul className="space-y-1 text-[13.5px]">
          {s.links.map((l) => (
            <li key={l}>
              <a href={l} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-signal-300 hover:underline">
                {l}
              </a>
            </li>
          ))}
        </ul>
      )}
      {s.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {s.attachments.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-[12.5px] text-mist-100 hover:border-signal-400">
                <Paperclip className="size-3.5" aria-hidden /> {a.name} <span className="text-mist-500">{Math.ceil(a.size / 1024)} KB</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="text-[12px] text-mist-500">
        Record hash <HashText value={s.submissionHash} />
      </div>
    </div>
  );
}

function NotesThread({ id, index, notes, disputed }: { id: string; index: number; notes: import("@/lib/client/types").Note[]; disputed?: boolean }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const kindLabel = { comment: "Comment", change_request: "Change request", dispute: "Dispute reason", evidence: "Evidence" } as const;
  return (
    <div>
      {notes.length === 0 ? (
        <p className="px-5 py-5 text-[14px] text-mist-400">No messages yet.</p>
      ) : (
        <ul className="divide-y divide-ink-700">
          {notes.map((n) => (
            <li key={n.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-mist-400">
                <span className="font-mono text-mist-200">{n.author.slice(0, 8)}…</span>
                <Badge tone={n.kind === "dispute" || n.kind === "evidence" ? "warning" : n.kind === "change_request" ? "info" : "neutral"}>{kindLabel[n.kind]}</Badge>
                <span>{formatDate(n.createdAt, true)}</span>
                {n.txHash && <TxLink hash={n.txHash} label="committed on-chain" />}
              </div>
              <p className="mt-1.5 whitespace-pre-line text-[14px] text-mist-100">{n.body}</p>
              {n.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {n.attachments.map((a) => (
                    <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-ink-600 px-2 py-1 text-[12px] text-mist-200 hover:border-signal-400">
                      <Paperclip className="size-3" /> {a.name}
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-3 border-t border-ink-700 p-5">
        <Field label={disputed ? "Add evidence or a comment" : "Add a comment"} htmlFor="note-body">
          <Textarea id="note-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {disputed && (
          <div className="text-[13px] text-mist-300">
            <label htmlFor="evidence-files" className="mb-1 flex items-center gap-1.5">
              <FileWarning className="size-3.5" aria-hidden /> Evidence files (PNG, JPEG, WebP or PDF, up to 2 MB each)
            </label>
            <input id="evidence-files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFiles(e.target.files)} className="text-[13px] text-mist-300 file:mr-3 file:rounded-md file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-mist-100" />
          </div>
        )}
        <Button
          variant="secondary"
          loading={busy}
          disabled={body.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            try {
              const kind = disputed ? "evidence" : "comment";
              if (files && files.length > 0) {
                const fd = new FormData();
                fd.set("kind", kind);
                fd.set("milestoneIndex", String(index));
                fd.set("body", body);
                fd.set("links", "[]");
                Array.from(files).forEach((f) => fd.append("files", f));
                const res = await fetch(`/api/projects/${id}/notes`, { method: "POST", body: fd });
                if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Upload failed");
              } else {
                await api(`/api/projects/${id}/notes`, { method: "POST", json: { kind, milestoneIndex: index, body, links: [] } });
              }
              setBody("");
              setFiles(null);
              await qc.invalidateQueries({ queryKey: ["notes", id] });
            } catch (e) {
              toast.error("Could not post", { description: e instanceof Error ? e.message : String(e) });
            } finally {
              setBusy(false);
            }
          }}
        >
          Post
        </Button>
      </div>
    </div>
  );
}
