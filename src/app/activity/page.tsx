"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { PageContainer } from "@/components/layout/gate";
import { Badge, EmptyState, Notice, PageHeader, Panel, Skeleton } from "@/components/ui/primitives";
import { Amount, TxLink } from "@/components/ui/chain";
import { api } from "@/lib/client/api";
import { formatDate, shortAddress } from "@/lib/utils";
import { ESCROW_ADDRESS, LEGACY_ESCROW_ADDRESS, HAS_LEGACY_ESCROW } from "@/config/contracts";
import { explorerAddress } from "@/config/chains";

interface EscrowRow {
  id: string;
  version: 1 | 2;
  createdAt: string | null;
  txHash: string;
  client: string;
  freelancer: string;
  clientTeam: string | null;
  freelancerTeam: string | null;
  team: boolean;
  status: string;
  milestones: number | null;
  total: string | null;
  funded: string | null;
  released: string | null;
  held: string | null;
  savings: boolean;
}

export default function ActivityPage() {
  const q = useQuery({
    queryKey: ["activity"],
    queryFn: () => api<{ escrows: EscrowRow[]; wallets: number; externalWallets: number; externalEscrows: number }>("/api/activity"),
    refetchInterval: 20_000,
  });
  const d = q.data;
  return (
    <PageContainer>
      <PageHeader
        title="Network activity"
        description="Every escrow created on the EscrowFlow contracts, read live from Mezo Testnet. Wallets the EscrowFlow team uses for its own tests are labelled, so outside usage is easy to see."
      />
      {d && (
        <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-ink-700 bg-ink-700 md:grid-cols-4">
          <Cell label="Escrows shown" value={d.escrows.length} />
          <Cell label="Distinct wallets" value={d.wallets} />
          <Cell label="Wallets outside the team" value={d.externalWallets} accent={d.externalWallets > 0} />
          <Cell label="Escrows with an outside party" value={d.externalEscrows} accent={d.externalEscrows > 0} />
        </dl>
      )}
      {q.isLoading && <Skeleton className="h-72" />}
      {q.isError && <Notice tone="danger" title="Could not load network activity">Reload the page to try again.</Notice>}
      {d && d.escrows.length === 0 && (
        <Panel>
          <EmptyState icon={<Activity className="size-5" />} title="No escrows yet" description="The first escrow created on the contract appears here within seconds." action={<Link href="/projects/new" className="text-signal-300 hover:underline">Create a project</Link>} />
        </Panel>
      )}
      {d && d.escrows.length > 0 && (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="border-b border-ink-700 text-[12px] text-mist-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Escrow</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Freelancer</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Funded</th>
                  <th className="px-4 py-3 text-right font-medium">Released</th>
                  <th className="px-4 py-3 text-right font-medium">Held</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700">
                {d.escrows.map((e) => (
                  <tr key={e.id} className="hover:bg-ink-800/60">
                    <td className="px-4 py-3">
                      <Link href={`/escrow/${e.id}`} className="font-medium text-white hover:text-signal-300">
                        #{e.id}
                      </Link>
                      <span className="ml-2 text-[11.5px] text-mist-500">v{e.version}</span>
                      {e.savings && <Badge tone="signal" className="ml-2">sMUSD</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <Party address={e.client} team={e.clientTeam} />
                    </td>
                    <td className="px-4 py-3">
                      <Party address={e.freelancer} team={e.freelancerTeam} />
                    </td>
                    <td className="px-4 py-3 text-mist-100">{e.status}</td>
                    <td className="px-4 py-3 text-right">{e.funded ? <Amount wei={e.funded} symbol={false} /> : "—"}</td>
                    <td className="px-4 py-3 text-right">{e.released ? <Amount wei={e.released} symbol={false} className={e.released !== "0" ? "text-signal-300" : ""} /> : "—"}</td>
                    <td className="px-4 py-3 text-right">{e.held ? <Amount wei={e.held} symbol={false} /> : "—"}</td>
                    <td className="px-4 py-3 text-mist-400">
                      <div>{e.createdAt ? formatDate(e.createdAt) : "—"}</div>
                      <TxLink hash={e.txHash} className="text-[11.5px]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <p className="mt-4 text-[12.5px] leading-relaxed text-mist-500">
        Amounts in MUSD. Contracts:{" "}
        <a className="text-signal-300 hover:underline" href={explorerAddress(ESCROW_ADDRESS)} target="_blank" rel="noopener noreferrer">
          EscrowFlow v2
        </a>
        {HAS_LEGACY_ESCROW && (
          <>
            {" "}and{" "}
            <a className="text-signal-300 hover:underline" href={explorerAddress(LEGACY_ESCROW_ADDRESS)} target="_blank" rel="noopener noreferrer">
              v1 (legacy)
            </a>
          </>
        )}
        , both source-verified on the Mezo explorer.
      </p>
    </PageContainer>
  );
}

function Cell({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-ink-850 px-5 py-4">
      <dt className="text-[12.5px] text-mist-400">{label}</dt>
      <dd className={`amount mt-1 text-[22px] font-semibold ${accent ? "text-signal-300" : "text-white"}`}>{value}</dd>
    </div>
  );
}

function Party({ address, team }: { address: string; team: string | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Link href={`/freelancers/${address}`} className="font-mono text-[12.5px] text-mist-100 hover:text-signal-300">
        {shortAddress(address)}
      </Link>
      {team && <span className="rounded border border-ink-600 px-1.5 text-[11px] text-mist-400" title={team}>team test</span>}
    </span>
  );
}
