"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Divide, Plus, Trash2, Info, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice, Panel, PanelHeader, Select, Textarea } from "@/components/ui/primitives";
import { HashText } from "@/components/ui/chain";
import { EscrowBar } from "@/components/escrow/escrow-ui";
import { api } from "@/lib/client/api";
import { CATEGORIES, buildTermsDocument, draftInputSchema, type DraftInput } from "@/lib/validation";
import { hashTerms } from "@/lib/terms";
import { checkMilestoneSum, formatMusd, splitEvenly, toDecimalString, tryParseMusd } from "@/lib/money";
import { cn, formatDuration } from "@/lib/utils";

interface MilestoneForm {
  title: string;
  description: string;
  deliverables: string;
  acceptanceCriteria: string;
  amount: string;
  deadline: string; // datetime-local
  reviewPeriodSeconds: number;
}

interface FormState {
  title: string;
  summary: string;
  description: string;
  category: DraftInput["category"];
  skills: string;
  budget: string;
  startDate: string;
  hiringMode: "direct" | "open";
  freelancer: string;
  milestones: MilestoneForm[];
  autoRelease: boolean;
  deadlineReclaim: boolean;
  graceDays: string;
  arbiter: string;
  cancellationTerms: string;
  disputeTerms: string;
  references: string;
}

const REVIEW_OPTIONS = [
  { label: "10 minutes (testnet demo)", value: 600 },
  { label: "1 day", value: 86_400 },
  { label: "2 days", value: 2 * 86_400 },
  { label: "3 days", value: 3 * 86_400 },
  { label: "5 days", value: 5 * 86_400 },
  { label: "7 days", value: 7 * 86_400 },
  { label: "14 days", value: 14 * 86_400 },
];

const DEFAULT_CANCEL =
  "Before funding, the client may cancel at no cost. After funding, either party may propose cancellation; if the other accepts, every unpaid and undisputed milestone is refunded to the client. Released payments are never reversed.";
const DEFAULT_DISPUTE =
  "Either party may open a dispute on a milestone, which freezes its funds. The parties resolve it by agreeing a split on-chain, or — if an arbiter is named — the arbiter rules on the split. Nobody can take disputed funds unilaterally.";

const toLocalInput = (unix: number) => {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? Math.floor(new Date(v).getTime() / 1000) : 0);
const inDays = (d: number) => toLocalInput(Math.floor(Date.now() / 1000) + d * 86_400);

const blankMilestone = (i: number): MilestoneForm => ({
  title: "",
  description: "",
  deliverables: "",
  acceptanceCriteria: "",
  amount: "",
  deadline: inDays(7 * (i + 1)),
  reviewPeriodSeconds: 3 * 86_400,
});

const TEMPLATES: { name: string; category: DraftInput["category"]; budget: string; milestones: [string, string, string, string][] }[] = [
  {
    name: "Website build (4 milestones)",
    category: "Development",
    budget: "200",
    milestones: [
      ["UI design", "40", "Figma file with desktop + mobile layouts", "All pages from the brief are designed\nClient feedback round included"],
      ["Frontend implementation", "60", "Responsive pages deployed to a preview URL", "Matches the approved design\nLighthouse accessibility score ≥ 90"],
      ["Backend integration", "60", "CMS / API wired up, forms working", "Content editable without code\nForms deliver to the agreed inbox"],
      ["Final delivery", "40", "Production deploy + handover notes", "Live on the client domain\nSource repository transferred"],
    ],
  },
  {
    name: "Brand identity (3 milestones)",
    category: "Design",
    budget: "120",
    milestones: [
      ["Concepts", "30", "Three logo directions", "Three distinct directions presented"],
      ["Refinement", "50", "Chosen direction refined + colour palette", "Two revision rounds included"],
      ["Brand kit", "40", "Logo files, palette, type guide (PDF)", "SVG, PNG and PDF exports delivered"],
    ],
  },
  {
    name: "Article series (2 milestones)",
    category: "Writing",
    budget: "80",
    milestones: [
      ["First two articles", "40", "Two 1,500-word articles", "Original, plagiarism-checked\nOne edit round each"],
      ["Final two articles", "40", "Two 1,500-word articles", "Original, plagiarism-checked\nOne edit round each"],
    ],
  },
];

export function initialFormFromDraft(d?: DraftInput): FormState {
  if (!d) {
    return {
      title: "",
      summary: "",
      description: "",
      category: "Development",
      skills: "",
      budget: "",
      startDate: "",
      hiringMode: "direct",
      freelancer: "",
      milestones: [blankMilestone(0), blankMilestone(1)],
      autoRelease: true,
      deadlineReclaim: true,
      graceDays: "3",
      arbiter: "",
      cancellationTerms: DEFAULT_CANCEL,
      disputeTerms: DEFAULT_DISPUTE,
      references: "",
    };
  }
  return {
    title: d.title,
    summary: d.summary,
    description: d.description,
    category: d.category,
    skills: d.skills.join(", "),
    budget: d.budget,
    startDate: d.startDate ?? "",
    hiringMode: d.hiringMode,
    freelancer: d.freelancer ?? "",
    milestones: d.milestones.map((m) => ({
      title: m.title,
      description: m.description,
      deliverables: m.deliverables.join("\n"),
      acceptanceCriteria: m.acceptanceCriteria.join("\n"),
      amount: m.amount,
      deadline: toLocalInput(m.deadline),
      reviewPeriodSeconds: m.reviewPeriodSeconds,
    })),
    autoRelease: d.rules.autoRelease,
    deadlineReclaim: d.rules.deadlineReclaim,
    graceDays: String(Math.round((d.rules.reclaimGracePeriodSeconds / 86_400) * 100) / 100),
    arbiter: d.rules.arbiter ?? "",
    cancellationTerms: d.rules.cancellationTerms,
    disputeTerms: d.rules.disputeTerms,
    references: d.references.join("\n"),
  };
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function toDraftInput(f: FormState): unknown {
  return {
    title: f.title,
    summary: f.summary,
    description: f.description,
    category: f.category,
    skills: f.skills.split(",").map((s) => s.trim()).filter(Boolean),
    budget: f.budget,
    startDate: f.startDate || null,
    hiringMode: f.hiringMode,
    freelancer: f.hiringMode === "direct" ? f.freelancer.trim() || null : null,
    milestones: f.milestones.map((m) => ({
      title: m.title,
      description: m.description,
      deliverables: lines(m.deliverables),
      acceptanceCriteria: lines(m.acceptanceCriteria),
      amount: m.amount,
      deadline: fromLocalInput(m.deadline),
      reviewPeriodSeconds: m.reviewPeriodSeconds,
    })),
    rules: {
      autoRelease: f.autoRelease,
      deadlineReclaim: f.deadlineReclaim,
      reclaimGracePeriodSeconds: f.deadlineReclaim ? Math.round(Number(f.graceDays || "0") * 86_400) : 0,
      arbiter: f.arbiter.trim() || null,
      cancellationTerms: f.cancellationTerms,
      disputeTerms: f.disputeTerms,
    },
    references: lines(f.references),
  };
}

export function ProjectForm({ mode, projectId, initial, lockHiring }: { mode: "create" | "edit"; projectId?: string; initial?: DraftInput; lockHiring?: boolean }) {
  const router = useRouter();
  const { address } = useAccount();
  const [f, setF] = useState<FormState>(() => initialFormFromDraft(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const setM = (i: number, patch: Partial<MilestoneForm>) => setF((p) => ({ ...p, milestones: p.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));

  const budget = tryParseMusd(f.budget);
  const amounts = f.milestones.map((m) => tryParseMusd(m.amount) ?? 0n);
  const sum = checkMilestoneSum(budget ?? 0n, amounts);
  const parsed = useMemo(() => draftInputSchema.safeParse(toDraftInput(f)), [f]);
  const preview = useMemo(() => {
    if (!parsed.success || !address) return null;
    try {
      const doc = buildTermsDocument(parsed.data, address);
      return { hash: hashTerms(doc) };
    } catch {
      return null;
    }
  }, [parsed, address]);

  const applyTemplate = (name: string) => {
    const t = TEMPLATES.find((x) => x.name === name);
    if (!t) return;
    setF((p) => ({
      ...p,
      category: t.category,
      budget: t.budget,
      milestones: t.milestones.map(([title, amount, deliverables, criteria], i) => ({
        ...blankMilestone(i),
        title,
        amount,
        deliverables,
        acceptanceCriteria: criteria,
      })),
    }));
  };

  const submit = async () => {
    const r = draftInputSchema.safeParse(toDraftInput(f));
    if (!r.success) {
      const e: Record<string, string> = {};
      for (const issue of r.error.issues) {
        const key = issue.path.join(".");
        if (!e[key]) e[key] = issue.message;
      }
      setErrors(e);
      toast.error("Check the highlighted fields", { description: r.error.issues[0]?.message });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (mode === "create") {
        const res = await api<{ id: string }>("/api/projects", { method: "POST", json: r.data });
        toast.success(r.data.hiringMode === "open" ? "Listing published" : "Agreement draft saved", {
          description: r.data.hiringMode === "open" ? "Freelancers can now apply from the marketplace." : "Next: create the escrow on-chain so the freelancer can accept.",
        });
        router.push(`/projects/${res.id}`);
      } else {
        const res = await api<{ needsOnchainUpdate?: boolean; unchanged?: boolean }>(`/api/projects/${projectId}`, { method: "PUT", json: r.data });
        toast.success(res.unchanged ? "No changes to save" : "Terms revision saved", {
          description: res.needsOnchainUpdate ? "Commit the new version on-chain from the project page. The freelancer will need to accept again." : undefined,
        });
        router.push(`/projects/${projectId}`);
      }
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const err = (k: string) => errors[k];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Who will do the work" description="Hire someone you know directly, or publish an open listing and choose from applicants." />
          <div className="space-y-4 p-5">
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Hiring mode">
              {(
                [
                  ["direct", "Direct hire", "You know the freelancer's wallet address."],
                  ["open", "Open listing", "Publish to the marketplace and review applications."],
                ] as const
              ).map(([v, title, desc]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={f.hiringMode === v}
                  disabled={lockHiring}
                  onClick={() => set("hiringMode", v)}
                  className={cn(
                    "rounded-[12px] border px-4 py-3 text-left transition-colors disabled:opacity-60",
                    f.hiringMode === v ? "border-signal-400 bg-signal-500/10" : "border-ink-600 bg-ink-800 hover:border-ink-500",
                  )}
                >
                  <div className="text-[14px] font-medium text-white">{title}</div>
                  <div className="mt-0.5 text-[12.5px] text-mist-400">{desc}</div>
                </button>
              ))}
            </div>
            {f.hiringMode === "direct" && (
              <Field label="Freelancer wallet address" htmlFor="freelancer" error={err("freelancer")} hint="The only wallet that can accept these terms, submit work and receive payments.">
                <Input id="freelancer" value={f.freelancer} onChange={(e) => set("freelancer", e.target.value)} placeholder="0x…" className="font-mono" aria-invalid={!!err("freelancer")} />
              </Field>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Project" description="This text becomes part of the agreement document both parties sign off on." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Title" htmlFor="title" error={err("title")}>
                <Input id="title" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Marketing website for Northwind Coffee" aria-invalid={!!err("title")} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="One-line summary" htmlFor="summary" optional error={err("summary")}>
                <Input id="summary" value={f.summary} onChange={(e) => set("summary", e.target.value)} maxLength={280} placeholder="Shown in the marketplace and on dashboards" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Description and scope" htmlFor="description" error={err("description")}>
                <Textarea id="description" value={f.description} onChange={(e) => set("description", e.target.value)} rows={5} placeholder="What needs to be built, for whom, and what is out of scope." aria-invalid={!!err("description")} />
              </Field>
            </div>
            <Field label="Category" htmlFor="category">
              <Select id="category" value={f.category} onChange={(e) => set("category", e.target.value as FormState["category"])}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Start date" htmlFor="start" optional>
              <Input id="start" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Skills" htmlFor="skills" optional hint="Comma separated, e.g. Next.js, Figma, Copywriting">
                <Input id="skills" value={f.skills} onChange={(e) => set("skills", e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Reference links" htmlFor="refs" optional hint="One https:// link per line (brief, designs, repository)." error={Object.entries(errors).find(([k]) => k.startsWith("references"))?.[1]}>
                <Textarea id="refs" value={f.references} onChange={(e) => set("references", e.target.value)} rows={2} className="font-mono text-[13px]" />
              </Field>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Budget and milestones"
            description="Each milestone is paid separately. Amounts must add up exactly to the budget."
            action={
              <div className="flex items-center gap-2">
                <LayoutTemplate className="size-4 text-mist-400" aria-hidden />
                <Select aria-label="Start from a template" className="h-8 w-auto text-[13px]" value="" onChange={(e) => applyTemplate(e.target.value)}>
                  <option value="">Start from a template…</option>
                  {TEMPLATES.map((t) => (
                    <option key={t.name}>{t.name}</option>
                  ))}
                </Select>
              </div>
            }
          />
          <div className="space-y-4 p-5">
            <div className="grid items-end gap-3 sm:grid-cols-[220px_1fr]">
              <Field label="Total budget (MUSD)" htmlFor="budget" error={err("budget")}>
                <Input id="budget" inputMode="decimal" value={f.budget} onChange={(e) => set("budget", e.target.value)} placeholder="200" className="amount text-[16px] font-semibold" aria-invalid={!!err("budget")} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!budget || f.milestones.length === 0}
                  onClick={() => {
                    const parts = splitEvenly(budget ?? 0n, f.milestones.length);
                    setF((p) => ({ ...p, milestones: p.milestones.map((m, i) => ({ ...m, amount: toDecimalString(parts[i]) })) }));
                  }}
                >
                  <Divide className="size-3.5" aria-hidden /> Split evenly
                </Button>
                <SumStatus ok={sum.ok} total={sum.total} difference={sum.difference} hasBudget={!!budget} />
              </div>
            </div>
            {err("milestones") && <Notice tone="danger">{err("milestones")}</Notice>}

            <ol className="space-y-3">
              {f.milestones.map((m, i) => (
                <li key={i} className="rounded-[12px] border border-ink-600 bg-ink-900/50">
                  <div className="flex items-center gap-2 border-b border-ink-700 px-4 py-2.5">
                    <span className="amount grid size-6 place-items-center rounded-full bg-held-500/20 text-[12px] font-semibold text-held-300">{i + 1}</span>
                    <span className="text-[13.5px] font-medium text-white">{m.title || `Milestone ${i + 1}`}</span>
                    <div className="ml-auto flex gap-1">
                      <IconBtn label="Move up" disabled={i === 0} onClick={() => setF((p) => ({ ...p, milestones: swap(p.milestones, i, i - 1) }))}>
                        <ArrowUp className="size-3.5" />
                      </IconBtn>
                      <IconBtn label="Move down" disabled={i === f.milestones.length - 1} onClick={() => setF((p) => ({ ...p, milestones: swap(p.milestones, i, i + 1) }))}>
                        <ArrowDown className="size-3.5" />
                      </IconBtn>
                      <IconBtn label="Remove milestone" disabled={f.milestones.length === 1} onClick={() => setF((p) => ({ ...p, milestones: p.milestones.filter((_, j) => j !== i) }))}>
                        <Trash2 className="size-3.5" />
                      </IconBtn>
                    </div>
                  </div>
                  <div className="grid gap-3 p-4 sm:grid-cols-6">
                    <div className="sm:col-span-4">
                      <Field label="Title" htmlFor={`m${i}t`} error={err(`milestones.${i}.title`)}>
                        <Input id={`m${i}t`} value={m.title} onChange={(e) => setM(i, { title: e.target.value })} placeholder="UI design" />
                      </Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Field label="Amount (MUSD)" htmlFor={`m${i}a`} error={err(`milestones.${i}.amount`)}>
                        <Input id={`m${i}a`} inputMode="decimal" value={m.amount} onChange={(e) => setM(i, { amount: e.target.value })} placeholder="40" className="amount" />
                      </Field>
                    </div>
                    <div className="sm:col-span-3">
                      <Field label="Deadline" htmlFor={`m${i}d`} error={err(`milestones.${i}.deadline`)}>
                        <Input id={`m${i}d`} type="datetime-local" value={m.deadline} onChange={(e) => setM(i, { deadline: e.target.value })} />
                      </Field>
                    </div>
                    <div className="sm:col-span-3">
                      <Field label="Client review period" htmlFor={`m${i}r`} hint="Time the client has to approve or request changes after a submission.">
                        <Select id={`m${i}r`} value={m.reviewPeriodSeconds} onChange={(e) => setM(i, { reviewPeriodSeconds: Number(e.target.value) })}>
                          {REVIEW_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div className="sm:col-span-6">
                      <Field label="Description" htmlFor={`m${i}desc`} optional>
                        <Textarea id={`m${i}desc`} rows={2} value={m.description} onChange={(e) => setM(i, { description: e.target.value })} />
                      </Field>
                    </div>
                    <div className="sm:col-span-3">
                      <Field label="Deliverables" htmlFor={`m${i}del`} optional hint="One per line">
                        <Textarea id={`m${i}del`} rows={3} value={m.deliverables} onChange={(e) => setM(i, { deliverables: e.target.value })} />
                      </Field>
                    </div>
                    <div className="sm:col-span-3">
                      <Field label="Acceptance criteria" htmlFor={`m${i}ac`} hint="One per line — what the client checks before paying" error={err(`milestones.${i}.acceptanceCriteria`)}>
                        <Textarea id={`m${i}ac`} rows={3} value={m.acceptanceCriteria} onChange={(e) => setM(i, { acceptanceCriteria: e.target.value })} />
                      </Field>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <Button type="button" variant="secondary" size="sm" disabled={f.milestones.length >= 20} onClick={() => setF((p) => ({ ...p, milestones: [...p.milestones, blankMilestone(p.milestones.length)] }))}>
              <Plus className="size-4" aria-hidden /> Add milestone
            </Button>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Rules the contract will enforce" description="These are written into the escrow on-chain and cannot change after funding." />
          <div className="space-y-5 p-5">
            <Toggle
              checked={f.autoRelease}
              onChange={(v) => set("autoRelease", v)}
              title="Auto-release after the review period"
              description="If the client neither approves, requests changes nor disputes within the review period, the freelancer can claim the milestone. Protects freelancers from clients who disappear."
            />
            <Toggle
              checked={f.deadlineReclaim}
              onChange={(v) => set("deadlineReclaim", v)}
              title="Deadline reclaim"
              description="If a milestone has no live submission by its deadline plus a grace period, the client can reclaim that milestone's funds. Submitted, disputed or paid work can never be reclaimed."
            >
              {f.deadlineReclaim && (
                <div className="mt-3 max-w-[200px]">
                  <Field label="Grace period (days)" htmlFor="grace" error={err("rules.reclaimGracePeriodSeconds")}>
                    <Input id="grace" inputMode="decimal" value={f.graceDays} onChange={(e) => set("graceDays", e.target.value)} />
                  </Field>
                </div>
              )}
            </Toggle>
            <Field label="Arbiter wallet" htmlFor="arbiter" optional error={err("rules.arbiter")} hint="A neutral third party who can rule on the split of a disputed milestone. Without one, disputes need both parties to agree.">
              <Input id="arbiter" value={f.arbiter} onChange={(e) => set("arbiter", e.target.value)} placeholder="0x… (leave empty for none)" className="font-mono" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cancellation terms" htmlFor="cancel">
                <Textarea id="cancel" rows={5} value={f.cancellationTerms} onChange={(e) => set("cancellationTerms", e.target.value)} />
              </Field>
              <Field label="Dispute terms" htmlFor="dispute">
                <Textarea id="dispute" rows={5} value={f.disputeTerms} onChange={(e) => set("disputeTerms", e.target.value)} />
              </Field>
            </div>
          </div>
        </Panel>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Panel raised>
          <PanelHeader title="Agreement preview" />
          <div className="space-y-4 p-5">
            <div>
              <div className="text-[12px] text-mist-400">Budget</div>
              <div className="amount mt-0.5 text-[28px] font-semibold tracking-[-0.02em] text-white">
                {budget ? formatMusd(budget) : "0.00"} <span className="text-[14px] font-medium text-mist-400">MUSD</span>
              </div>
            </div>
            <EscrowBar amounts={amounts.map((a) => (a > 0n ? a : 1n))} statuses={null} funded={false} />
            <ul className="space-y-1.5 text-[13px]">
              {f.milestones.map((m, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="truncate text-mist-300">
                    M{i + 1} · {m.title || "Untitled"}
                  </span>
                  <span className="amount shrink-0 text-mist-100">{formatMusd(amounts[i])}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t border-ink-700 pt-3 text-[12.5px] text-mist-400">
              <div className="flex justify-between">
                <dt>Auto-release</dt>
                <dd className="text-mist-100">{f.autoRelease ? "Yes" : "No"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Deadline reclaim</dt>
                <dd className="text-mist-100">{f.deadlineReclaim ? `Yes, +${formatDuration(Math.round(Number(f.graceDays || 0) * 86_400))}` : "No"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Arbiter</dt>
                <dd className="text-mist-100">{f.arbiter ? "Named" : "None"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Platform fee</dt>
                <dd className="text-mist-100">None</dd>
              </div>
            </dl>
            <div className="rounded-[10px] border border-ink-700 bg-ink-900/60 p-3 text-[12.5px] text-mist-400">
              <div className="flex items-center gap-1.5 text-mist-300">
                <Info className="size-3.5" aria-hidden /> Terms hash
              </div>
              {preview ? <HashText value={preview.hash} className="mt-1" /> : <p className="mt-1">Complete the form to compute the hash that goes on-chain.</p>}
            </div>
            <Button className="w-full" size="lg" loading={saving} onClick={submit}>
              {mode === "create" ? (f.hiringMode === "open" ? "Publish listing" : "Save agreement draft") : "Save terms revision"}
            </Button>
            <p className="text-[12px] leading-relaxed text-mist-500">
              Saving does not move any funds. {mode === "create" && f.hiringMode === "direct" ? "Next you create the escrow on-chain; the freelancer then accepts, and only then can you fund it." : ""}
            </p>
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function swap<T>(arr: T[], a: number, b: number) {
  const c = [...arr];
  [c[a], c[b]] = [c[b], c[a]];
  return c;
}

function IconBtn({ children, label, onClick, disabled }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="rounded-md p-1.5 text-mist-400 hover:bg-ink-700 hover:text-white disabled:opacity-30">
      {children}
    </button>
  );
}

function SumStatus({ ok, total, difference, hasBudget }: { ok: boolean; total: bigint; difference: bigint; hasBudget: boolean }) {
  if (!hasBudget) return <span className="text-[12.5px] text-mist-500">Enter a budget to check the split.</span>;
  if (ok) return <span className="text-[12.5px] text-paid-300">Milestones add up exactly to the budget.</span>;
  return (
    <span className="text-[12.5px] text-warn-300" role="status">
      Allocated {formatMusd(total)} — {difference > 0n ? `${formatMusd(difference)} MUSD unallocated` : `${formatMusd(-difference)} MUSD over budget`}
    </span>
  );
}

function Toggle({ checked, onChange, title, description, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors", checked ? "border-signal-400 bg-signal-500" : "border-ink-500 bg-ink-700")}
      >
        <span className={cn("absolute top-0.5 size-[18px] rounded-full bg-white transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
      </button>
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-white">{title}</div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-mist-400">{description}</p>
        {children}
      </div>
    </div>
  );
}
