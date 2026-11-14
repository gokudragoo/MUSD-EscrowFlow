"use client";

import { formatDuration } from "@/lib/utils";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Paperclip, Plus, X } from "lucide-react";
import { PageContainer, SignInGate } from "@/components/layout/gate";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice, PageHeader, Panel, PanelHeader, Skeleton, Textarea } from "@/components/ui/primitives";
import { Amount, HashText } from "@/components/ui/chain";
import { useProject } from "@/hooks/useProject";
import { useEscrowTx } from "@/hooks/useEscrowTx";
import { useNow } from "@/hooks/useClient";
import { milestoneActions } from "@/lib/escrow-state";
import { useAccount } from "wagmi";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

export default function SubmitWorkPage({ params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = use(params);
  return (
    <SignInGate>
      <PageContainer className="max-w-4xl">
        <SubmitWork id={id} index={Number(index)} />
      </PageContainer>
    </SignInGate>
  );
}

function SubmitWork({ id, index }: { id: string; index: number }) {
  const router = useRouter();
  const { address } = useAccount();
  const { view, chain, isLoading } = useProject(id);
  const tx = useEscrowTx();
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState<string[]>([""]);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [prepared, setPrepared] = useState<{ hash: `0x${string}` } | null>(null);
  const now = useNow(10_000);

  if (isLoading) return <Skeleton className="h-96" />;
  if (!view || !chain) return <Notice tone="warning" title="The escrow is not active yet" />;
  const m = chain.milestones[index];
  const t = view.terms?.milestones[index];
  if (!m) return <Notice tone="danger" title="Milestone not found" />;
  const can = milestoneActions(chain.project, m, address, now).submit;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!ALLOWED.includes(f.type)) {
        toast.error(`${f.name}: only PNG, JPEG, WebP and PDF are accepted`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is larger than 2 MB`);
        continue;
      }
      next.push(f);
    }
    setFiles(next.slice(0, 5));
  };

  const submit = async () => {
    setSaving(true);
    try {
      let hash = prepared?.hash;
      if (!hash) {
        const fd = new FormData();
        fd.set("milestoneIndex", String(index));
        fd.set("description", description);
        fd.set("links", JSON.stringify(links.map((l) => l.trim()).filter(Boolean)));
        files.forEach((f) => fd.append("files", f));
        const res = await fetch(`/api/projects/${id}/submissions`, { method: "POST", body: fd });
        const body = (await res.json().catch(() => ({}))) as { submissionHash?: `0x${string}`; error?: string };
        if (!res.ok || !body.submissionHash) throw new Error(body.error ?? "Could not save the submission");
        hash = body.submissionHash;
        setPrepared({ hash });
      }
      setSaving(false);
      const r = await tx.run({ label: `Submit M${index + 1}`, functionName: "submitMilestone", args: [BigInt(chain.id), BigInt(index), hash], escrowFn: "submitMilestone", successMessage: "Work submitted — the client has been notified" });
      if (r) router.push(`/projects/${id}/milestones/${index}`);
    } catch (e) {
      toast.error("Submission failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Link href={`/projects/${id}/milestones/${index}`} className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] text-mist-300 hover:text-white">
        <ArrowLeft className="size-4" /> {t?.title ?? `Milestone ${index + 1}`}
      </Link>
      <PageHeader
        title={`Submit work for milestone ${index + 1}`}
        description={
          <>
            {t?.title} · <Amount wei={m.amount} className="text-white" />. Your files stay private to the client, you and the arbiter; only a hash of this submission goes on-chain, with a timestamp.
          </>
        }
      />
      {!can.available && <Notice tone="warning" title="You cannot submit this milestone right now" className="mb-6">{can.reason}</Notice>}
      <Panel>
        <PanelHeader title="Deliverables" />
        <div className="space-y-5 p-5">
          <Field label="What you delivered" htmlFor="desc" hint="Map your work to the acceptance criteria so the client can review quickly.">
            <Textarea id="desc" rows={6} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!!prepared} />
          </Field>
          {t && (
            <div className="rounded-[10px] border border-ink-700 bg-ink-900/50 p-3 text-[13px] text-mist-300">
              <div className="font-medium text-mist-100">Acceptance criteria</div>
              <ul className="mt-1 list-disc pl-5">
                {t.acceptanceCriteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-mist-100">Links (repository, commit, design file, document)</div>
            {links.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Input value={l} onChange={(e) => setLinks(links.map((x, j) => (j === i ? e.target.value : x)))} placeholder="https://github.com/org/repo/commit/…" className="font-mono text-[13px]" aria-label={`Link ${i + 1}`} disabled={!!prepared} />
                {links.length > 1 && (
                  <Button variant="ghost" size="sm" aria-label="Remove link" onClick={() => setLinks(links.filter((_, j) => j !== i))} disabled={!!prepared}>
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setLinks([...links, ""])} disabled={links.length >= 10 || !!prepared}>
              <Plus className="size-4" /> Add link
            </Button>
          </div>
          <div className="space-y-2">
            <label htmlFor="files" className="text-[13px] font-medium text-mist-100">
              Attachments <span className="font-normal text-mist-500">(optional · up to 5 files · PNG, JPEG, WebP, PDF · 2 MB each)</span>
            </label>
            <input id="files" type="file" multiple accept={ALLOWED.join(",")} onChange={(e) => addFiles(e.target.files)} disabled={!!prepared} className="block text-[13px] text-mist-300 file:mr-3 file:rounded-md file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-mist-100" />
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <li key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1 text-[12.5px] text-mist-100">
                    <Paperclip className="size-3.5" /> {f.name}
                    {!prepared && (
                      <button aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                        <X className="size-3.5 text-mist-400" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {prepared && (
            <Notice tone="info" title="Submission saved — commit it on-chain">
              Record hash <HashText value={prepared.hash} />. If the transaction was rejected, press the button again to retry with the same record.
            </Notice>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-ink-700 pt-4">
            <Button size="lg" disabled={!can.available || description.trim().length < 10} loading={saving || tx.busy} onClick={submit}>
              {prepared ? "Submit on-chain" : "Save and submit on-chain"}
            </Button>
            <p className="text-[12.5px] text-mist-500">
              {description.trim().length < 10 && !prepared
                ? "Describe what you delivered (at least 10 characters) to continue."
                : `Submitting starts the client's ${formatDuration(m.reviewPeriod)} review period.`}
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
