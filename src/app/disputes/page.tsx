"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { PageContainer, SignInGate } from "@/components/layout/gate";
import { Badge, EmptyState, Notice, PageHeader, Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { Amount, TxLink } from "@/components/ui/chain";
import { api } from "@/lib/client/api";
import { formatDate } from "@/lib/utils";

interface OpenDispute {
  chainProjectId: string;
  projectId: string | null;
  title: string;
  milestoneIndex: number;
  milestoneTitle: string;
  amountWei: string;
  initiator: string;
  openedAt: number;
  settlementProposer: string | null;
  proposedFreelancerAmountWei: string;
  arbiter: string | null;
  role: string;
  status: string;
}
interface ClosedDispute {
  chainProjectId: string;
  projectId: string | null;
  title: string;
  milestoneIndex: number;
  outcome: string;
  freelancerAmountWei: string | null;
  clientAmountWei: string | null;
  txHash: string;
  at: string | null;
}

export default function DisputesPage() {
  return (
    <SignInGate title="Sign in to see your disputes">
      <PageContainer>
        <Disputes />
      </PageContainer>
    </SignInGate>
  );
}

function Disputes() {
  const q = useQuery({ queryKey: ["disputes"], queryFn: () => api<{ open: OpenDispute[]; closed: ClosedDispute[] }>("/api/disputes"), refetchInterval: 30_000 });
  return (
    <div>
      <PageHeader
        title="Dispute centre"
        description="A disputed milestone is frozen by the contract. It is resolved only by a split both parties accept, by the arbiter named in the terms, or by the initiator withdrawing it. EscrowFlow does not decide who is right."
      />
      {q.isLoading && <Skeleton className="h-64" />}
      {q.error && <Notice tone="danger" title="Could not load disputes">{(q.error as Error).message}</Notice>}
      {q.data && (
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Open disputes" description="Funds frozen until resolved" />
            {q.data.open.length === 0 ? (
              <EmptyState icon={<Scale className="size-5" />} title="No open disputes" description="If a milestone is contested, open a dispute from its page. Evidence and proposals appear here." />
            ) : (
              <ul className="divide-y divide-ink-700">
                {q.data.open.map((d) => (
                  <li key={`${d.chainProjectId}-${d.milestoneIndex}`} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={d.projectId ? `/projects/${d.projectId}/milestones/${d.milestoneIndex}` : `/escrow/${d.chainProjectId}`} className="text-[15px] font-semibold text-white hover:text-signal-300">
                        {d.title} · M{d.milestoneIndex + 1} {d.milestoneTitle}
                      </Link>
                      <Badge tone="warning" dot>{d.status}</Badge>
                      <Badge>You are the {d.role}</Badge>
                      <Amount wei={d.amountWei} className="ml-auto font-semibold text-white" />
                    </div>
                    <div className="mt-1 text-[12.5px] text-mist-400">
                      Opened {formatDate(d.openedAt, true)} by {d.initiator.slice(0, 8)}… · {d.arbiter ? `Arbiter ${d.arbiter.slice(0, 8)}… can rule` : "No arbiter: requires a mutual split"}
                      {d.settlementProposer && <> · Proposal: <Amount wei={d.proposedFreelancerAmountWei} /> to the freelancer</>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Resolved and withdrawn" />
            {q.data.closed.length === 0 ? (
              <p className="px-5 py-6 text-[14px] text-mist-400">No resolved disputes yet.</p>
            ) : (
              <ul className="divide-y divide-ink-700">
                {q.data.closed.map((d) => (
                  <li key={d.txHash + d.milestoneIndex} className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-[13.5px]">
                    <Link href={d.projectId ? `/projects/${d.projectId}/milestones/${d.milestoneIndex}` : `/escrow/${d.chainProjectId}`} className="font-medium text-white hover:text-signal-300">
                      {d.title} · M{d.milestoneIndex + 1}
                    </Link>
                    <Badge tone={d.outcome === "Withdrawn" ? "neutral" : "released"}>{d.outcome}</Badge>
                    {d.freelancerAmountWei && (
                      <span className="text-mist-400">
                        <Amount wei={d.freelancerAmountWei} /> to freelancer · <Amount wei={d.clientAmountWei ?? "0"} /> to client
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-3 text-mist-500">
                      {d.at && formatDate(d.at, true)} <TxLink hash={d.txHash} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
