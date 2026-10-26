"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Bell, Briefcase, CalendarClock, CircleDollarSign, Plus, Store } from "lucide-react";
import { PageContainer, SignInGate } from "@/components/layout/gate";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Notice, PageHeader, Panel, PanelHeader, Skeleton, Stat } from "@/components/ui/primitives";
import { Amount, TxLink } from "@/components/ui/chain";
import { EscrowBar, ProjectStatusPill } from "@/components/escrow/escrow-ui";
import { api } from "@/lib/client/api";
import { PROJECT_STATUS_LABEL } from "@/lib/escrow-state";
import { cn, formatDate, relativeTime } from "@/lib/utils";

interface Dash {
  generatedAt: string;
  blockNumber: string | null;
  client: { lockedWei: string; releasedWei: string; refundedWei: string; awaitingFundingWei: string; activeProjects: number; pendingReviews: number; openDisputes: number };
  freelancer: { receivedWei: string; allocatedWei: string; pendingPaymentWei: string; activeProjects: number; awaitingReview: number; openDisputes: number };
  projects: { chainProjectId: string; projectId: string | null; title: string; href: string; role: "client" | "freelancer"; status: number; ledger: Record<string, string>; milestoneStatuses: number[]; milestoneAmounts: string[]; counterparty: string }[];
  actions: { kind: string; label: string; title: string; href: string; dueAt: number | null }[];
  deadlines: { title: string; milestone: string; href: string; dueAt: number; state: string; role: string; amount: string }[];
  reviews: { title: string; milestone: string; href: string; amount: string; reviewEndsAt: number; overdue: boolean; role: string }[];
  recentPayments: { txHash: string; at: string | null; event: string; title: string; projectTitle: string; milestoneIndex: number | null; amountWei: string }[];
  drafts: { id: string; title: string; budget_wei: string; listing_status: string; hiring_mode: string; updated_at: string; applications: number }[];
}

export default function DashboardPage() {
  return (
    <SignInGate title="Sign in to see your dashboard">
      <PageContainer>
        <Dashboard />
      </PageContainer>
    </SignInGate>
  );
}

function Dashboard() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dash>("/api/dashboard"), refetchInterval: 20_000 });
  const notes = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ notifications: { id: string; title: string; body: string; href: string | null; created_at: string; read_at: string | null }[]; unread: number }>("/api/notifications") });
  const [viewChoice, setView] = useState<"client" | "freelancer" | null>(null);
  const d = q.data;
  const defaultView: "client" | "freelancer" =
    d && d.projects.filter((p) => p.role === "freelancer").length > d.projects.filter((p) => p.role === "client").length + d.drafts.length ? "freelancer" : "client";
  const view = viewChoice ?? defaultView;

  if (q.isLoading) return <DashSkeleton />;
  if (q.error) return <Notice tone="danger" title="Could not load your dashboard">{(q.error as Error).message}</Notice>;
  if (!d) return null;
  const projects = d.projects.filter((p) => p.role === view);
  const actions = d.actions;
  const isEmpty = d.projects.length === 0 && d.drafts.length === 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={d.blockNumber ? `Balances read from the EscrowFlow contract at block ${Number(d.blockNumber).toLocaleString("en-US")}.` : "Your escrow activity on Mezo Testnet."}
        actions={
          <>
            <div className="flex rounded-[10px] border border-ink-600 bg-ink-850 p-0.5" role="tablist" aria-label="Dashboard view">
              {(["client", "freelancer"] as const).map((r) => (
                <button key={r} role="tab" aria-selected={view === r} onClick={() => setView(r)} className={cn("rounded-[8px] px-3 py-1.5 text-[13px] font-medium", view === r ? "bg-ink-700 text-white" : "text-mist-400 hover:text-white")}>
                  As {r}
                </button>
              ))}
            </div>
            <Link href="/projects/new">
              <Button size="sm">
                <Plus className="size-4" aria-hidden /> New project
              </Button>
            </Link>
          </>
        }
      />

      {isEmpty ? (
        <Panel>
          <EmptyState
            icon={<Briefcase className="size-5" />}
            title="No projects yet"
            description="Create a project to hire a freelancer with milestone escrow, or browse open projects if you are a freelancer."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/projects/new"><Button>Create a project</Button></Link>
                <Link href="/marketplace"><Button variant="outline"><Store className="size-4" /> Browse the marketplace</Button></Link>
              </div>
            }
          />
        </Panel>
      ) : (
        <div className="space-y-6">
          <Panel className="p-5">
            {view === "client" ? (
              <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
                <Stat label="Locked in active escrows" value={<Amount wei={d.client.lockedWei} />} hint="Held by the contract, not yet paid" />
                <Stat label="Released to freelancers" value={<Amount wei={d.client.releasedWei} />} hint={<>Refunded to you: <Amount wei={d.client.refundedWei} /></>} />
                <Stat label="Pending reviews" value={d.client.pendingReviews} hint="Submitted milestones waiting for you" />
                <Stat label="Open disputes" value={d.client.openDisputes} hint={`${d.client.activeProjects} active projects`} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
                <Stat label="Total received" value={<Amount wei={d.freelancer.receivedWei} />} hint="Paid to your wallet on-chain" />
                <Stat label="Allocated to your projects" value={<Amount wei={d.freelancer.allocatedWei} />} hint="Held in escrow — not earned until released" />
                <Stat label="Pending payment" value={<Amount wei={d.freelancer.pendingPaymentWei} />} hint={`${d.freelancer.awaitingReview} submissions awaiting review`} />
                <Stat label="Open disputes" value={d.freelancer.openDisputes} hint={`${d.freelancer.activeProjects} active projects`} />
              </div>
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-6">
              <Panel>
                <PanelHeader title="Needs your attention" description="Actions available to you right now, checked against contract rules." />
                {actions.length === 0 ? (
                  <p className="px-5 py-6 text-[14px] text-mist-400">Nothing waiting on you.</p>
                ) : (
                  <ul className="divide-y divide-ink-700">
                    {actions.map((a, i) => (
                      <li key={i}>
                        <Link href={a.href} className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink-800/60">
                          <span className={cn("size-2 rounded-full", a.kind === "review" || a.kind === "fund" ? "bg-signal-400" : a.kind === "settlement" || a.kind === "cancellation" ? "bg-warn-400" : "bg-held-400")} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-medium text-white">{a.label}</div>
                            <div className="truncate text-[12.5px] text-mist-400">{a.title}{a.dueAt ? ` · due ${relativeTime(a.dueAt)}` : ""}</div>
                          </div>
                          <ArrowRight className="size-4 text-mist-500" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel>
                <PanelHeader title={view === "client" ? "Your projects as client" : "Your projects as freelancer"} />
                {projects.length === 0 ? (
                  <p className="px-5 py-6 text-[14px] text-mist-400">No on-chain escrows in this role yet.</p>
                ) : (
                  <ul className="divide-y divide-ink-700">
                    {projects.map((p) => (
                      <li key={p.chainProjectId} className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={p.href} className="text-[15px] font-semibold text-white hover:text-signal-300">{p.title}</Link>
                          <ProjectStatusPill status={p.status} label={PROJECT_STATUS_LABEL[p.status]} />
                          <span className="ml-auto text-[13px] text-mist-400">
                            <Amount wei={p.ledger.held} className="text-held-300" /> held · <Amount wei={p.ledger.released} className="text-paid-300" /> released
                          </span>
                        </div>
                        <div className="mt-3">
                          <EscrowBar amounts={p.milestoneAmounts} statuses={p.milestoneStatuses} funded={BigInt(p.ledger.funded) > 0n} size="sm" />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {view === "client" && d.drafts.length > 0 && (
                <Panel>
                  <PanelHeader title="Drafts and open listings" description="Application records — not yet on-chain." />
                  <ul className="divide-y divide-ink-700">
                    {d.drafts.map((x) => (
                      <li key={x.id}>
                        <Link href={`/projects/${x.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-ink-800/60">
                          <span className="text-[14px] font-medium text-white">{x.title}</span>
                          <Badge tone={x.listing_status === "open" ? "info" : "neutral"}>{x.listing_status === "open" ? `Open listing · ${x.applications} applications` : "Draft"}</Badge>
                          <Amount wei={x.budget_wei} className="ml-auto text-[13px] text-mist-300" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>

            <aside className="space-y-6">
              <Panel>
                <PanelHeader title="Upcoming deadlines" description="Next 7 days and overdue" action={<CalendarClock className="size-4 text-mist-400" />} />
                {d.deadlines.filter((x) => x.role === view).length === 0 ? (
                  <p className="px-5 py-5 text-[13.5px] text-mist-400">No deadlines this week.</p>
                ) : (
                  <ul className="divide-y divide-ink-700">
                    {d.deadlines.filter((x) => x.role === view).map((x, i) => (
                      <li key={i}>
                        <Link href={x.href} className="block px-5 py-3 hover:bg-ink-800/60">
                          <div className="flex items-center gap-2 text-[13.5px] font-medium text-white">
                            {x.state === "overdue" && <AlertTriangle className="size-3.5 text-danger-300" aria-label="Overdue" />}
                            <span className="truncate">{x.milestone}</span>
                          </div>
                          <div className={cn("mt-0.5 text-[12.5px]", x.state === "overdue" ? "text-danger-300" : x.state === "due_soon" ? "text-warn-300" : "text-mist-400")}>
                            {x.state === "overdue" ? "Overdue since" : "Due"} {formatDate(x.dueAt, true)} · {x.title}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel>
                <PanelHeader title="Recent payments" description="Verified on-chain" action={<CircleDollarSign className="size-4 text-mist-400" />} />
                {d.recentPayments.length === 0 ? (
                  <p className="px-5 py-5 text-[13.5px] text-mist-400">No payments yet.</p>
                ) : (
                  <ul className="divide-y divide-ink-700">
                    {d.recentPayments.slice(0, 6).map((p) => (
                      <li key={p.txHash + p.event + p.milestoneIndex} className="px-5 py-3">
                        <div className="flex items-center justify-between gap-2 text-[13.5px]">
                          <span className="font-medium text-white">{p.title}</span>
                          <Amount wei={p.amountWei} className="text-mist-100" />
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-mist-400">
                          <span className="truncate">{p.projectTitle}{p.milestoneIndex !== null ? ` · M${p.milestoneIndex + 1}` : ""}</span>
                          <TxLink hash={p.txHash} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="border-t border-ink-700 px-5 py-3 text-right">
                  <Link href="/payments" className="text-[13px] text-signal-300 hover:underline">All payments</Link>
                </div>
              </Panel>
              <Panel>
                <PanelHeader title="Notifications" action={<Bell className="size-4 text-mist-400" />} />
                {(notes.data?.notifications ?? []).length === 0 ? (
                  <p className="px-5 py-5 text-[13.5px] text-mist-400">You are all caught up.</p>
                ) : (
                  <ul className="divide-y divide-ink-700">
                    {notes.data!.notifications.slice(0, 5).map((n) => (
                      <li key={n.id}>
                        <Link href={n.href ?? "/notifications"} className="block px-5 py-3 hover:bg-ink-800/60">
                          <div className="flex items-center gap-2 text-[13.5px] text-white">
                            {!n.read_at && <span className="size-1.5 rounded-full bg-signal-400" aria-label="Unread" />}
                            <span className="truncate">{n.title}</span>
                          </div>
                          <div className="mt-0.5 text-[12px] text-mist-500">{relativeTime(n.created_at)}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}

function DashSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-28" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
