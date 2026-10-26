"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageContainer } from "@/components/layout/gate";
import { Notice, PageHeader, Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { AddressChip, Amount, TxLink } from "@/components/ui/chain";
import { EscrowBar, KeyValue, LedgerSummary, MilestonePill, ProjectStatusPill } from "@/components/escrow/escrow-ui";
import { api } from "@/lib/client/api";
import { reviveChain, type ChainViewJson } from "@/lib/client/types";
import { PROJECT_STATUS_LABEL, milestoneDisplay } from "@/lib/escrow-state";
import { useSession } from "@/hooks/useSession";
import { formatDate } from "@/lib/utils";

interface Resp {
  chain: ChainViewJson;
  linkedProjectId: string | null;
  events: { tx_hash: string; title: string; block_number: string; block_time: string | null; milestone_index: number | null }[];
}

/** Public, facts-only view of an escrow by its contract id. */
export default function EscrowPage({ params }: { params: Promise<{ chainId: string }> }) {
  const { chainId } = use(params);
  const router = useRouter();
  const { isSignedIn } = useSession();
  const q = useQuery({ queryKey: ["escrow", chainId], queryFn: () => api<Resp>(`/api/escrow/${chainId}`) });
  const chain = reviveChain(q.data?.chain);
  useEffect(() => {
    if (isSignedIn && q.data?.linkedProjectId) router.prefetch(`/projects/${q.data.linkedProjectId}`);
  }, [isSignedIn, q.data, router]);
  return (
    <PageContainer>
      {q.isLoading && <Skeleton className="h-96" />}
      {q.error && <Notice tone="danger" title="Escrow not found">{(q.error as Error).message}</Notice>}
      {chain && (
        <div className="space-y-6">
          <PageHeader
            eyebrow="Public on-chain record"
            title={`Escrow #${chain.id}`}
            description="Facts read directly from the EscrowFlow contract. Agreement text and submissions are private to the participants."
            actions={
              <>
                <ProjectStatusPill status={chain.project.status} label={PROJECT_STATUS_LABEL[chain.project.status]} />
                {q.data?.linkedProjectId && (
                  <Link href={`/projects/${q.data.linkedProjectId}`} className="text-[13.5px] text-signal-300 hover:underline">
                    Open project (participants)
                  </Link>
                )}
              </>
            }
          />
          <Panel className="space-y-4 p-5">
            <EscrowBar amounts={chain.milestones.map((m) => m.amount)} statuses={chain.milestones.map((m) => m.status)} funded={chain.project.fundedAmount > 0n} showLegend size="lg" />
            <LedgerSummary ledger={chain.ledger} reconciled={chain.reconciliation.ok} blockNumber={chain.blockNumber} />
          </Panel>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Milestones" />
              <ul className="divide-y divide-ink-700">
                {chain.milestones.map((m, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
                    <span className="text-mist-100">M{i + 1}</span>
                    <MilestonePill display={milestoneDisplay(chain.project, m)} />
                    <span className="text-mist-500">due {formatDate(Number(m.deadline))}</span>
                    <Amount wei={m.amount} className="ml-auto text-white" />
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel>
              <PanelHeader title="Parties and terms" />
              <dl className="divide-y divide-ink-700 px-5 text-[13.5px]">
                <KeyValue label="Client"><AddressChip address={chain.project.client} /></KeyValue>
                <KeyValue label="Freelancer"><AddressChip address={chain.project.freelancer} /></KeyValue>
                <KeyValue label="Terms version">v{chain.project.termsVersion}</KeyValue>
                <KeyValue label="Auto-release">{chain.project.autoRelease ? "Yes" : "No"}</KeyValue>
                <KeyValue label="Deadline reclaim">{chain.project.deadlineReclaim ? "Yes" : "No"}</KeyValue>
              </dl>
            </Panel>
          </div>
          <Panel>
            <PanelHeader title="Events" description="Decoded EscrowFlow events" />
            <ul className="divide-y divide-ink-700">
              {(q.data?.events ?? []).map((e, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
                  <span className="text-white">{e.title}</span>
                  {e.milestone_index !== null && <span className="text-mist-400">M{e.milestone_index + 1}</span>}
                  <span className="text-mist-500">{e.block_time ? formatDate(e.block_time, true) : `block ${e.block_number}`}</span>
                  <TxLink hash={e.tx_hash} className="ml-auto" />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </PageContainer>
  );
}
