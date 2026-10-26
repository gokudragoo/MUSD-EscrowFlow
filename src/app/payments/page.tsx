"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Download, Receipt } from "lucide-react";
import { PageContainer, SignInGate } from "@/components/layout/gate";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Notice, PageHeader, Panel, Skeleton } from "@/components/ui/primitives";
import { Amount, TxLink } from "@/components/ui/chain";
import { api } from "@/lib/client/api";
import { formatDate } from "@/lib/utils";

interface Item {
  txHash: string;
  blockNumber: string;
  at: string | null;
  event: string;
  title: string;
  chainProjectId: string;
  projectId: string | null;
  projectTitle: string;
  milestoneIndex: number | null;
  amountWei: string;
  freelancerAmountWei: string | null;
  clientAmountWei: string | null;
  direction: "in" | "out" | "info";
}

const TONE: Record<string, "held" | "released" | "refunded" | "warning"> = {
  ProjectFunded: "held",
  MilestoneReleased: "released",
  MilestoneRefunded: "refunded",
  ProjectCancelled: "refunded",
  DisputeResolved: "warning",
};

export default function PaymentsPage() {
  return (
    <SignInGate title="Sign in to see your payments">
      <PageContainer>
        <Payments />
      </PageContainer>
    </SignInGate>
  );
}

function Payments() {
  const q = useQuery({ queryKey: ["payments"], queryFn: () => api<{ items: Item[] }>("/api/payments") });
  return (
    <div>
      <PageHeader
        title="Payments and transactions"
        description="Funding, milestone releases, refunds and settlements for your escrows. Every row is a decoded EscrowFlow event with its transaction hash."
        actions={
          <a href="/api/payments?format=csv">
            <Button size="sm" variant="secondary">
              <Download className="size-4" aria-hidden /> Export CSV
            </Button>
          </a>
        }
      />
      {q.isLoading && <Skeleton className="h-64" />}
      {q.error && <Notice tone="danger" title="Could not load payments">{(q.error as Error).message}</Notice>}
      {q.data && q.data.items.length === 0 && (
        <Panel>
          <EmptyState icon={<Receipt className="size-5" />} title="No payments yet" description="Funding and milestone payments appear here once they are confirmed on-chain." />
        </Panel>
      )}
      {q.data && q.data.items.length > 0 && (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13.5px]">
            <thead className="border-b border-ink-700 text-[12px] text-mist-400">
              <tr>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-3 py-3 font-medium">Event</th>
                <th className="px-3 py-3 font-medium">Project</th>
                <th className="px-3 py-3 text-right font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Transaction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {q.data.items.map((i) => (
                <tr key={i.txHash + i.event + i.milestoneIndex} className="hover:bg-ink-800/40">
                  <td className="whitespace-nowrap px-5 py-3 text-mist-300">{i.at ? formatDate(i.at, true) : `block ${i.blockNumber}`}</td>
                  <td className="px-3 py-3">
                    <Badge tone={TONE[i.event] ?? "neutral"}>{i.title}</Badge>
                    {i.direction === "in" && <span className="ml-2 text-[12px] text-paid-300">to you</span>}
                    {i.direction === "out" && <span className="ml-2 text-[12px] text-mist-400">from you</span>}
                  </td>
                  <td className="px-3 py-3">
                    <Link href={i.projectId ? `/projects/${i.projectId}` : `/escrow/${i.chainProjectId}`} className="text-mist-100 hover:text-signal-300">
                      {i.projectTitle}
                    </Link>
                    {i.milestoneIndex !== null && <span className="text-mist-500"> · M{i.milestoneIndex + 1}</span>}
                    {i.event === "DisputeResolved" && i.freelancerAmountWei && (
                      <div className="text-[12px] text-mist-500">
                        <Amount wei={i.freelancerAmountWei} muted /> to freelancer · <Amount wei={i.clientAmountWei ?? "0"} muted /> to client
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-white">
                    <Amount wei={i.amountWei} />
                  </td>
                  <td className="px-5 py-3">
                    <TxLink hash={i.txHash} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
