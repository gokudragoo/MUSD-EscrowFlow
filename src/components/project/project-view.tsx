"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { AlertTriangle, CalendarPlus, Clock, ExternalLink, History, Lock, Pencil, Printer, QrCode, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Field, Input, Notice, PageHeader, Panel, PanelHeader, Skeleton, Textarea } from "@/components/ui/primitives";
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { AddressChip, Amount, HashText, TxLink } from "@/components/ui/chain";
import { EscrowBar, KeyValue, LedgerSummary, MilestonePill, ProjectStatusPill, Timeline } from "@/components/escrow/escrow-ui";
import { AcceptTermsPanel, CancellationPanel, CommitTermsButton, CreateEscrowButton, MilestoneActionBar, SavingsPanel, SimpleTxButton } from "./actions";
import { SignInInline } from "@/components/layout/gate";
import { TermsDocumentView } from "./terms-document";
import { useProject } from "@/hooks/useProject";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/client/api";
import type { ChainView, ProjectViewJson } from "@/lib/client/types";
import {
  MilestoneStatus,
  PROJECT_STATUS_LABEL,
  ProjectStatus,
  deadlineState,
  effectiveDeadline,
  milestoneDisplay,
  projectActions,
  reviewDeadlineOf,
} from "@/lib/escrow-state";
import { explorerAddress } from "@/config/chains";
import { countdown, formatDate, formatDuration } from "@/lib/utils";
import { formatMusd } from "@/lib/money";

const nowSec = () => Math.floor(Date.now() / 1000);

const TABS = ["milestones", "terms", "activity", "applications"] as const;

export function ProjectView({ id }: { id: string }) {
  const { address } = useAccount();
  const { isSignedIn } = useSession();
  const search = useSearchParams();
  const requestedTab = search.get("tab");
  const [tab, setTab] = useState<string>(TABS.includes(requestedTab as (typeof TABS)[number]) ? requestedTab! : "milestones");
  const [inviteOpen, setInviteOpen] = useState(false);
  const { view, chain, isLoading, error } = useProject(id);
  if (isLoading) return <ProjectSkeleton />;
  if (error) return <Notice tone="danger" title="Could not load this project">{(error as Error).message}</Notice>;
  if (!view) return null;
  if (view.private) {
    return (
      <Panel>
        <EmptyState
          icon={<Lock className="size-5" />}
          title={isSignedIn ? "This project is private" : "Sign in to open this project"}
          description={
            isSignedIn
              ? "Only the client, the freelancer and the agreed arbiter can see its terms and history. You are signed in with a wallet that is not part of it."
              : "If you were invited, connect the wallet named in the agreement and sign in. Only the client, the freelancer and the arbiter can see the terms."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {!isSignedIn && <SignInInline />}
              {chain && (
                <Link href={`/escrow/${chain.id}`}>
                  <Button variant="outline">View public on-chain facts</Button>
                </Link>
              )}
            </div>
          }
        />
      </Panel>
    );
  }
  const terms = view.terms;
  const funded = !!chain && chain.project.fundedAmount > 0n;
  const statusLabel = chain ? PROJECT_STATUS_LABEL[chain.project.status] : view.project.listingStatus === "open" ? "Open listing" : "Draft (off-chain)";
  const amounts = chain ? chain.milestones.map((m) => m.amount) : (terms?.milestones.map((m) => BigInt(m.amount)) ?? []);
  const isClient = view.access === "client";
  const pa = chain ? projectActions(chain.project, address, chain.milestones, nowSec()) : null;
  const canEdit = isClient && (!chain || pa?.editTerms.available);

  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/projects" className="hover:text-white">Projects</Link>
            <span aria-hidden>/</span>
            <span>{chain ? `Escrow #${chain.id}` : "Not on-chain yet"}</span>
          </span>
        }
        title={view.project.title}
        description={view.project.summary || undefined}
        actions={
          <>
            <ProjectStatusPill status={chain?.project.status ?? null} label={statusLabel} />
            <RoleBadge access={view.access} />
            {canEdit && (
              <Link href={`/projects/${id}/edit`}>
                <Button size="sm" variant="secondary">
                  <Pencil className="size-3.5" aria-hidden /> Edit terms
                </Button>
              </Link>
            )}
            {(view.access === "client" || view.access === "freelancer" || view.access === "arbiter") && (
              <>
                <Link href={`/projects/${id}/agreement`}>
                  <Button size="sm" variant="secondary">
                    <Printer className="size-3.5" aria-hidden /> Agreement
                  </Button>
                </Link>
                <a href={`/api/projects/${id}/calendar`}>
                  <Button size="sm" variant="secondary">
                    <CalendarPlus className="size-3.5" aria-hidden /> Calendar
                  </Button>
                </a>
              </>
            )}
            {isClient && <InviteButton id={id} open={inviteOpen} onOpenChange={setInviteOpen} />}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {chain?.version === 1 && (
            <Notice icon={<History className="size-4" />} title="Legacy escrow (EscrowFlow v1)">
              This escrow lives on the first EscrowFlow contract. Its history and balances stay verifiable; new escrows use v2, which adds sMUSD savings and
              stricter dispute rules.
            </Notice>
          )}
          <NextStep view={view} chain={chain} onCreated={() => setInviteOpen(true)} />

          <Panel>
            <PanelHeader title="Escrow" description={funded ? "Live balances read from the EscrowFlow contract." : "Nothing is locked until the client funds the escrow."} />
            <div className="space-y-4 p-5">
              <EscrowBar amounts={amounts} statuses={chain?.milestones.map((m) => m.status) ?? null} funded={funded} showLegend size="lg" />
              {chain ? (
                <LedgerSummary ledger={chain.ledger} reconciled={chain.reconciliation.ok} blockNumber={chain.blockNumber} />
              ) : (
                <p className="text-[13.5px] text-mist-400">
                  Budget <Amount wei={view.project.budgetWei ?? "0"} className="text-white" /> across {amounts.length} milestones — not yet created on-chain.
                </p>
              )}
            </div>
          </Panel>

          {chain?.yield?.enabled && (
            <Panel>
              <PanelHeader title="sMUSD savings" description="Held MUSD sits in Mezo's MUSDSavingsRate vault while work is in progress." />
              <div className="p-5">
                <SavingsPanel chain={chain} who={address} />
              </div>
            </Panel>
          )}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="milestones">Milestones</TabsTrigger>
              <TabsTrigger value="terms">Terms</TabsTrigger>
              <TabsTrigger value="activity" count={view.timeline?.length}>Activity</TabsTrigger>
              {view.project.hiringMode === "open" && <TabsTrigger value="applications">Applications</TabsTrigger>}
            </TabsList>
            <TabsContent value="milestones" className="pt-4">
              <MilestoneList view={view} chain={chain} who={address} />
            </TabsContent>
            <TabsContent value="terms" className="pt-4">
              {terms ? (
                <div className="space-y-4">
                  <Panel className="p-5 sm:p-7">
                    <TermsDocumentView terms={chain && view.onchainTerms ? view.onchainTerms : terms} termsHash={chain?.project.termsHash ?? view.termsHash} version={chain?.project.termsVersion} />
                  </Panel>
                  {view.revisions && view.revisions.length > 0 && <RevisionHistory revisions={view.revisions} committed={chain?.project.termsHash ?? null} />}
                </div>
              ) : (
                <Notice>Terms are visible to participants only.</Notice>
              )}
            </TabsContent>
            <TabsContent value="activity" className="pt-4">
              <Panel>
                <PanelHeader title="Project history" description="On-chain facts are decoded from verified EscrowFlow events. Application records are actions taken in this app." />
                <Timeline items={view.timeline ?? []} milestoneTitles={terms?.milestones.map((m) => m.title)} />
              </Panel>
            </TabsContent>
            {view.project.hiringMode === "open" && (
              <TabsContent value="applications" className="pt-4">
                <Applications view={view} />
              </TabsContent>
            )}
          </Tabs>
        </div>

        <aside className="space-y-6">
          <Panel>
            <PanelHeader title="Parties" />
            <dl className="divide-y divide-ink-700 px-5">
              <KeyValue label="Client">
                <PartyLink address={chain?.project.client ?? view.project.client ?? ""} me={address} />
              </KeyValue>
              <KeyValue label="Freelancer">
                {chain?.project.freelancer || view.project.freelancer ? <PartyLink address={chain?.project.freelancer ?? view.project.freelancer!} me={address} /> : <span className="text-mist-500">Not selected yet</span>}
              </KeyValue>
              <KeyValue label="Arbiter">
                {terms?.rules.arbiter ? <PartyLink address={terms.rules.arbiter} me={address} /> : <span className="text-mist-500">None</span>}
              </KeyValue>
            </dl>
          </Panel>
          <Panel>
            <PanelHeader title="Rules" description="Enforced by the contract" />
            <dl className="divide-y divide-ink-700 px-5 text-[13.5px]">
              <KeyValue label="Auto-release after review">{(chain?.project.autoRelease ?? terms?.rules.autoRelease) ? "Yes" : "No"}</KeyValue>
              <KeyValue label="Client deadline reclaim">
                {(chain?.project.deadlineReclaim ?? terms?.rules.deadlineReclaim) ? `Yes, after ${formatDuration(chain?.project.reclaimGracePeriod ?? terms?.rules.reclaimGracePeriodSeconds ?? 0)} grace` : "No"}
              </KeyValue>
              <KeyValue label="sMUSD savings">
                {chain?.version === 2
                  ? chain.yield?.enabled
                    ? `On, ${chain.yield.freelancerBps / 100}% of yield to freelancer`
                    : "Off"
                  : terms?.rules.savings?.enabled
                    ? `On, ${terms.rules.savings.freelancerShareBps / 100}% of yield to freelancer`
                    : chain
                      ? "Not available (v1)"
                      : "Off"}
              </KeyValue>
              <KeyValue label="Platform fee">None</KeyValue>
              <KeyValue label="Category">{view.project.category}</KeyValue>
            </dl>
          </Panel>
          <Panel>
            <PanelHeader title="On-chain references" />
            <dl className="divide-y divide-ink-700 px-5 text-[13.5px]">
              <KeyValue label="Contract">
                <a className="inline-flex items-center gap-1 text-signal-300 hover:underline" href={explorerAddress(chain?.escrow ?? "")} target="_blank" rel="noopener noreferrer">
                  EscrowFlow {chain?.version === 1 ? "v1" : "v2"} <ExternalLink className="size-3" />
                </a>
              </KeyValue>
              <KeyValue label="Escrow id">{chain ? `#${chain.id}` : "—"}</KeyValue>
              <KeyValue label="Terms hash">{chain ? <HashText value={chain.project.termsHash} /> : <HashText value={view.termsHash} />}</KeyValue>
              <KeyValue label="Terms version">{chain ? `v${chain.project.termsVersion}${chain.project.acceptedVersion ? ` · accepted v${chain.project.acceptedVersion}` : " · not accepted"}` : "Draft"}</KeyValue>
              {view.project.createTxHash && <KeyValue label="Created in"><TxLink hash={view.project.createTxHash} /></KeyValue>}
              {chain && chain.project.fundedAt > 0n && <KeyValue label="Funded">{formatDate(Number(chain.project.fundedAt), true)}</KeyValue>}
            </dl>
          </Panel>
          {chain && chain.project.status === ProjectStatus.Active && (view.access === "client" || view.access === "freelancer") && (
            <Panel>
              <PanelHeader title="Cancel the project" description="Requires both parties. Paid milestones are never reversed." />
              <div className="space-y-2 p-5">
                {chain.project.cancelProposer !== "0x0000000000000000000000000000000000000000" && (
                  <Notice tone="warning" title="Cancellation proposed">
                    Proposed by {chain.project.cancelProposer.toLowerCase() === address?.toLowerCase() ? "you" : "the other party"}. Any new submission withdraws it automatically.
                  </Notice>
                )}
                <CancellationPanel chain={chain} who={address} />
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function RoleBadge({ access }: { access: ProjectViewJson["access"] }) {
  const label = { client: "You are the client", freelancer: "You are the freelancer", arbiter: "You are the arbiter", applicant: "You applied", public: "Viewing" }[access];
  return <Badge tone={access === "public" ? "neutral" : "signal"}>{label}</Badge>;
}

function PartyLink({ address, me }: { address: string; me?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Link href={`/freelancers/${address}`} className="font-mono text-[12.5px] text-mist-100 hover:text-signal-300">
        {address.slice(0, 6)}…{address.slice(-4)}
      </Link>
      {me && me.toLowerCase() === address.toLowerCase() && <Badge tone="info">You</Badge>}
      <AddressChip address={address} label="" className="[&>span:first-child]:hidden" />
    </span>
  );
}

/** One prominent, role-aware "what happens next" card. */
function NextStep({ view, chain, onCreated }: { view: ProjectViewJson; chain: ChainView | null; onCreated?: () => void }) {
  const { address } = useAccount();
  const { isSignedIn } = useSession();
  const id = view.project.id;
  const access = view.access;
  let title = "";
  let body: React.ReactNode = null;
  let action: React.ReactNode = null;
  let tone: "info" | "warning" = "info";

  if (!chain) {
    if (access === "client") {
      if (view.project.listingStatus === "open") {
        title = "Collecting applications";
        body = "Freelancers can apply from the marketplace. Select one in the Applications tab; the escrow is created with their wallet afterwards.";
      } else {
        title = "Create the escrow on-chain";
        body = "This records the milestone amounts, deadlines, review periods, rules and the terms hash in the EscrowFlow contract. No funds move yet; the freelancer must accept first.";
        action = isSignedIn ? <CreateEscrowButton view={view} onDone={onCreated} /> : null;
      }
    } else if (view.project.listingStatus === "open") {
      title = access === "applicant" ? "Application sent" : "Apply to this project";
      body = access === "applicant" ? "The client will review applications and select a freelancer." : "Introduce yourself and how you would approach the work.";
      action = access === "applicant" ? null : <ApplyForm id={id} />;
    } else {
      title = "Waiting for the client";
      body = "The client has not created the escrow on-chain yet.";
    }
  } else {
    const p = chain.project;
    const pa = projectActions(p, address, chain.milestones, nowSec());
    if (access === "client" && view.draftDiffers && pa.editTerms.available) {
      title = "Commit your terms revision";
      body = "Your saved draft differs from the terms recorded on-chain. Committing it resets the freelancer's acceptance.";
      action = <CommitTermsButton view={view} chainId={BigInt(chain.id)} />;
      tone = "warning";
    } else if (p.status === ProjectStatus.AwaitingAcceptance) {
      if (pa.acceptTerms.available) {
        title = `Review and accept terms version ${p.termsVersion}`;
        body = "Read the Terms tab carefully. Your browser recomputes the document hash and compares every parameter with the contract.";
        action = <AcceptTermsPanel view={view} chain={chain} />;
      } else {
        title = "Waiting for the freelancer to accept";
        body = "The freelancer needs to accept this exact version of the terms. Share the project link or QR code with them.";
        action = access === "client" ? <SimpleTxButton label="Cancel project" fn="cancelUnfunded" args={[BigInt(chain.id)]} variant="outline" confirmTitle="Cancel this unfunded project?" confirmBody="No funds are involved. The escrow will be marked cancelled permanently." /> : null;
      }
    } else if (p.status === ProjectStatus.AwaitingFunding) {
      if (pa.fund.available) {
        title = "Fund the escrow";
        body = <>The freelancer accepted version {p.acceptedVersion}. Deposit exactly <Amount wei={p.totalAmount} className="text-white" /> to start the work.</>;
        action = (
          <div className="flex flex-wrap gap-2">
            <Link href={`/projects/${id}/fund`}>
              <Button size="lg">Fund escrow</Button>
            </Link>
            <SimpleTxButton label="Cancel project" fn="cancelUnfunded" args={[BigInt(chain.id)]} variant="outline" confirmTitle="Cancel this unfunded project?" confirmBody="No funds are involved. The escrow will be marked cancelled permanently." />
          </div>
        );
      } else if (access === "client") {
        title = "Funding blocked";
        body = pa.fund.reason;
        tone = "warning";
        action = (
          <div className="flex flex-wrap gap-2">
            {pa.editTerms.available && (
              <Link href={`/projects/${id}/edit`}>
                <Button variant="secondary">Edit the terms</Button>
              </Link>
            )}
            <SimpleTxButton label="Cancel project" fn="cancelUnfunded" args={[BigInt(chain.id)]} variant="outline" confirmTitle="Cancel this unfunded project?" confirmBody="No funds are involved. The escrow will be marked cancelled permanently." />
          </div>
        );
      } else {
        title = "Waiting for the client to fund";
        body = "You accepted the terms. Work should start once the escrow shows as funded — the app checks the contract, not a screenshot.";
        action = pa.revokeAcceptance.available ? <SimpleTxButton label="Withdraw acceptance" fn="revokeAcceptance" args={[BigInt(chain.id)]} variant="outline" /> : null;
      }
    } else if (p.status === ProjectStatus.Active) {
      const submitted = chain.milestones.filter((m) => m.status === MilestoneStatus.Submitted).length;
      const disputed = p.openDisputes;
      title = p.cancelled ? "Cancelled — resolving remaining disputes" : "Escrow funded and active";
      body = (
        <>
          <Amount wei={chain.ledger.held} className="text-white" /> is held by the contract{chain.yield?.enabled ? ", earning the sMUSD savings rate" : ""}.{" "}
          {submitted > 0 && `${submitted} milestone${submitted > 1 ? "s" : ""} awaiting review. `}
          {disputed > 0 && `${disputed} open dispute${disputed > 1 ? "s" : ""}.`}
        </>
      );
    } else if (p.status === ProjectStatus.Completed) {
      title = "Project completed";
      body = <>Every milestone is settled on-chain. Released: <Amount wei={p.releasedAmount} className="text-white" />.</>;
      action = access === "client" || access === "freelancer" ? <ReviewForm id={id} /> : null;
    } else if (p.status === ProjectStatus.Cancelled) {
      title = "Project cancelled";
      body = p.fundedAmount > 0n ? <>Refunded to the client: <Amount wei={p.refundedAmount} className="text-white" />. Released before cancellation: <Amount wei={p.releasedAmount} className="text-white" />.</> : "Cancelled before funding. No funds moved.";
    }
  }
  if (!title) return null;
  return (
    <Panel className={tone === "warning" ? "border-warn-400/45" : "border-ink-600"}>
      <div className="space-y-3 border-l-2 border-signal-500 p-5 sm:p-6">
        <h2 className="display text-[21px] text-white">{title}</h2>
        {body && <div className="max-w-2xl text-[14px] leading-relaxed text-mist-300">{body}</div>}
        {action && <div className="pt-1">{action}</div>}
      </div>
    </Panel>
  );
}

function MilestoneList({ view, chain, who }: { view: ProjectViewJson; chain: ChainView | null; who?: string }) {
  const terms = view.terms;
  const count = chain?.milestones.length ?? terms?.milestones.length ?? 0;
  const now = nowSec();
  return (
    <ol className="space-y-3">
      {Array.from({ length: count }).map((_, i) => {
        const t = terms?.milestones[i];
        const m = chain?.milestones[i];
        const display = milestoneDisplay(chain?.project ?? null, m ?? null);
        const deadline = m ? effectiveDeadline(m) : (t?.deadline ?? 0);
        const ds = m ? deadlineState(m, now) : "none";
        return (
          <li key={i}>
            <Panel className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start gap-3">
                <span className="amount grid size-7 shrink-0 place-items-center rounded-full border border-ink-600 bg-ink-800 text-[12.5px] font-semibold text-mist-100">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/projects/${view.project.id}/milestones/${i}`} className="text-[15px] font-semibold text-white hover:text-signal-300">
                      {t?.title ?? `Milestone ${i + 1}`}
                    </Link>
                    <MilestonePill display={display} />
                    {ds === "overdue" && <Badge tone="danger"><AlertTriangle className="size-3" /> Overdue</Badge>}
                    {ds === "due_soon" && <Badge tone="warning"><Clock className="size-3" /> Due soon</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-mist-400">
                    <span>Due {formatDate(deadline, true)}</span>
                    <span>Review period {formatDuration(m?.reviewPeriod ?? t?.reviewPeriodSeconds ?? 0)}</span>
                    {m && m.revision > 0 && <span>Revision {m.revision}</span>}
                    {m && m.status === MilestoneStatus.Submitted && (
                      <span className={now >= reviewDeadlineOf(m) ? "text-warn-300" : ""}>
                        {now >= reviewDeadlineOf(m) ? `Review period ended ${formatDate(reviewDeadlineOf(m), true)}` : `Review ends in ${countdown(reviewDeadlineOf(m))}`}
                      </span>
                    )}
                    {m && m.status === MilestoneStatus.Resolved && <span>Split: {formatMusd(m.releasedAmount)} / {formatMusd(m.refundedAmount)}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <Amount wei={m?.amount ?? t?.amount ?? "0"} className="text-[16px] font-semibold text-white" />
                </div>
              </div>
              {chain && m && chain.project.status === ProjectStatus.Active && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-700 pt-4">
                  <MilestoneActionBar view={view} chain={chain} index={i} who={who} compact />
                  <Link href={`/projects/${view.project.id}/milestones/${i}`} className="ml-auto text-[13px] text-signal-300 hover:underline">
                    Details and history
                  </Link>
                </div>
              )}
            </Panel>
          </li>
        );
      })}
    </ol>
  );
}

function InviteButton({ id, open, onOpenChange: setOpen }: { id: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/projects/${id}` : "";
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <QrCode className="size-3.5" aria-hidden /> Invite
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Invite the freelancer" description="Share this link or QR code. They sign in with the wallet named in the terms to review and accept.">
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-xl bg-white p-3">
            <QRCodeSVG value={url || "https://musd-escrowflow.vercel.app"} size={184} />
          </div>
          <div className="flex w-full gap-2">
            <Input readOnly value={url} className="font-mono text-[12px]" aria-label="Invite link" />
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(url).catch(() => undefined);
                toast.success("Link copied");
              }}
            >
              Copy
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function ApplyForm({ id }: { id: string }) {
  const { isSignedIn } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState({ introduction: "", proposedTimeline: "", portfolio: "", skills: "" });
  const [busy, setBusy] = useState(false);
  if (!isSignedIn) return <SignInInline label="Sign in to apply" />;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Introduction" htmlFor="intro">
          <Textarea id="intro" rows={4} value={f.introduction} onChange={(e) => setF({ ...f, introduction: e.target.value })} placeholder="Relevant experience and how you would approach this project" />
        </Field>
      </div>
      <Field label="Proposed timeline" htmlFor="timeline" optional>
        <Input id="timeline" value={f.proposedTimeline} onChange={(e) => setF({ ...f, proposedTimeline: e.target.value })} placeholder="e.g. 4 weeks" />
      </Field>
      <Field label="Skills" htmlFor="askills" optional>
        <Input id="askills" value={f.skills} onChange={(e) => setF({ ...f, skills: e.target.value })} placeholder="Comma separated" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Portfolio links" htmlFor="aport" optional hint="One https:// link per line">
          <Textarea id="aport" rows={2} value={f.portfolio} onChange={(e) => setF({ ...f, portfolio: e.target.value })} className="font-mono text-[13px]" />
        </Field>
      </div>
      <div>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/projects/${id}/applications`, {
                method: "POST",
                json: {
                  introduction: f.introduction,
                  proposedTimeline: f.proposedTimeline,
                  skills: f.skills.split(",").map((s) => s.trim()).filter(Boolean),
                  portfolioLinks: f.portfolio.split("\n").map((s) => s.trim()).filter(Boolean),
                  proposal: "",
                },
              });
              toast.success("Application sent");
              await qc.invalidateQueries();
            } catch (e) {
              toast.error("Could not apply", { description: e instanceof Error ? e.message : String(e) });
            } finally {
              setBusy(false);
            }
          }}
        >
          Send application
        </Button>
      </div>
    </div>
  );
}

interface AppItem {
  id: string;
  freelancer: string;
  introduction: string;
  skills: string[];
  portfolioLinks: string[];
  proposedTimeline: string;
  status: string;
  createdAt: string;
  displayName: string | null;
  headline: string | null;
}

function Applications({ view }: { view: ProjectViewJson }) {
  const { isSignedIn } = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["applications", view.project.id],
    queryFn: () => api<{ applications: AppItem[]; isClient: boolean }>(`/api/projects/${view.project.id}/applications`),
    enabled: isSignedIn,
  });
  const act = async (appId: string, action: "select" | "decline" | "withdraw") => {
    try {
      await api(`/api/projects/${view.project.id}/applications/${appId}`, { method: "POST", json: { action } });
      toast.success(action === "select" ? "Freelancer selected — create the escrow next" : action === "decline" ? "Application declined" : "Application withdrawn");
      await qc.invalidateQueries();
    } catch (e) {
      toast.error("Action failed", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  if (!isSignedIn) return <Notice>Sign in to see applications.</Notice>;
  if (q.isLoading) return <Skeleton className="h-40" />;
  const apps = q.data?.applications ?? [];
  if (apps.length === 0) return <Panel><EmptyState icon={<Users className="size-5" />} title="No applications yet" description="Applications appear here as freelancers apply from the marketplace." /></Panel>;
  return (
    <div className="space-y-3">
      {apps.map((a) => (
        <Panel key={a.id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link href={`/freelancers/${a.freelancer}`} className="text-[15px] font-semibold text-white hover:text-signal-300">
                {a.displayName ?? `${a.freelancer.slice(0, 8)}…`}
              </Link>
              {a.headline && <div className="text-[13px] text-mist-400">{a.headline}</div>}
              <div className="mt-1 font-mono text-[12px] text-mist-500">{a.freelancer}</div>
            </div>
            <Badge tone={a.status === "selected" ? "released" : a.status === "submitted" ? "info" : "neutral"}>{a.status}</Badge>
          </div>
          <p className="mt-3 whitespace-pre-line text-[14px] leading-relaxed text-mist-200">{a.introduction}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-mist-400">
            {a.proposedTimeline && <span>Timeline: {a.proposedTimeline}</span>}
            {a.skills.length > 0 && <span>Skills: {a.skills.join(", ")}</span>}
            {a.portfolioLinks.map((l) => (
              <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow" className="text-signal-300 hover:underline">
                {new URL(l).hostname}
              </a>
            ))}
          </div>
          <div className="mt-2 text-[11.5px] text-mist-500">Application record · off-chain claims, not verified</div>
          {q.data?.isClient && a.status === "submitted" && !view.project.chainProjectId && (
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={() => act(a.id, "select")}>Select freelancer</Button>
              <Button size="sm" variant="ghost" onClick={() => act(a.id, "decline")}>Decline</Button>
            </div>
          )}
          {!q.data?.isClient && a.status === "submitted" && (
            <div className="mt-4">
              <Button size="sm" variant="ghost" onClick={() => act(a.id, "withdraw")}>Withdraw application</Button>
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

function ReviewForm({ id }: { id: string }) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <p className="text-[13px] text-paid-300">Thanks — your review is published on their profile (labelled as user-submitted).</p>;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Rate the other party" htmlFor="rating">
        <select id="rating" value={rating} onChange={(e) => setRating(Number(e.target.value))} className="h-10 rounded-[8px] border border-ink-600 bg-ink-950/60 px-3 text-[14px]">
          {[5, 4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>
              {r} / 5
            </option>
          ))}
        </select>
      </Field>
      <div className="min-w-[220px] flex-1">
        <Field label="Feedback" htmlFor="rbody" optional>
          <Input id="rbody" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
      </div>
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await api(`/api/projects/${id}/reviews`, { method: "POST", json: { rating, body } });
            setDone(true);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (/already/i.test(msg)) setDone(true);
            else toast.error("Could not save review", { description: msg });
          }
        }}
      >
        Publish review
      </Button>
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-36" />
      <Skeleton className="h-48" />
      <Skeleton className="h-48" />
    </div>
  );
}

function RevisionHistory({ revisions, committed }: { revisions: NonNullable<ProjectViewJson["revisions"]>; committed: string | null }) {
  return (
    <Panel>
      <PanelHeader title="Terms history" description="Every saved version of the agreement. Revisions are append-only; the highlighted one is committed on-chain." />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="text-[12px] text-mist-400">
            <tr className="border-b border-ink-700">
              <th className="px-5 py-2.5 font-medium">Version</th>
              <th className="px-5 py-2.5 font-medium">Saved</th>
              <th className="px-5 py-2.5 font-medium">Terms hash</th>
              <th className="px-5 py-2.5 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700">
            {revisions.map((r) => {
              const isCommitted = !!committed && r.terms_hash.toLowerCase() === committed.toLowerCase();
              return (
                <tr key={r.revision} className={isCommitted ? "bg-signal-500/[0.06]" : undefined}>
                  <td className="px-5 py-2.5 text-mist-100">
                    r{r.revision} {isCommitted && <Badge tone="signal" className="ml-1">On-chain</Badge>}
                  </td>
                  <td className="px-5 py-2.5 text-mist-300">{formatDate(r.created_at, true)}</td>
                  <td className="px-5 py-2.5">
                    <HashText value={r.terms_hash} />
                  </td>
                  <td className="px-5 py-2.5 text-mist-400">{r.note || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
