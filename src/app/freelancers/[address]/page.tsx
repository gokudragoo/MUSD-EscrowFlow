"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Link2, ShieldCheck, Star } from "lucide-react";
import { PageContainer } from "@/components/layout/gate";
import { Badge, EmptyState, Notice, Panel, PanelHeader, Skeleton, Stat } from "@/components/ui/primitives";
import { AddressChip, Amount, SourceTag, TxLink } from "@/components/ui/chain";
import { Avatar } from "@/components/ui/avatar";
import { api } from "@/lib/client/api";
import type { Profile } from "@/lib/client/types";
import { formatDate, shortAddress } from "@/lib/utils";

interface ProfileResponse {
  address: string;
  profile: Profile | null;
  history: {
    freelancer: { projects: number; completed: number; milestonesPaid: number; receivedWei: string };
    client: { projectsFunded: number; completed: number; releasedWei: string };
    payments: { txHash: string; at: string | null; chainProjectId: string; milestoneIndex: number; amountWei: string }[];
  };
  reviews: { rating: number; body: string; reviewer: string; created_at: string }[];
}

export default function FreelancerProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const q = useQuery({ queryKey: ["profile", address], queryFn: () => api<ProfileResponse>(`/api/profiles/${address}`) });
  const d = q.data;
  return (
    <PageContainer>
      {q.isLoading && <Skeleton className="h-96" />}
      {q.error && <Notice tone="danger" title="Profile not found">{(q.error as Error).message}</Notice>}
      {d && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <Panel className="p-6">
              <div className="flex flex-wrap items-center gap-4">
                <Avatar url={d.profile?.avatarUrl ?? null} name={d.profile?.displayName ?? d.address} size={64} />
                <div className="min-w-0">
                  <h1 className="text-[24px] font-semibold text-white">{d.profile?.displayName ?? shortAddress(d.address)}</h1>
                  <div className="text-[14px] text-mist-300">{d.profile?.headline || (d.profile ? d.profile.role : "No profile published")}</div>
                  <AddressChip address={d.address} className="mt-1" />
                </div>
                {d.profile?.available && <Badge tone="released" className="ml-auto">Available for work</Badge>}
              </div>
              {d.profile?.bio && <p className="mt-5 whitespace-pre-line text-[14.5px] leading-relaxed text-mist-200">{d.profile.bio}</p>}
              {d.profile && d.profile.skills.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {d.profile.skills.map((s) => (
                    <span key={s} className="rounded-md bg-ink-700 px-2 py-0.5 text-[12.5px] text-mist-200">{s}</span>
                  ))}
                </div>
              )}
              <div className="mt-5"><SourceTag source="app" /> <span className="ml-1 text-[12px] text-mist-500">Profile details are self-reported and not verified.</span></div>
            </Panel>

            {d.profile && d.profile.portfolioLinks.length > 0 && (
              <Panel>
                <PanelHeader title="Portfolio" description="Links provided by the freelancer" />
                <ul className="divide-y divide-ink-700">
                  {d.profile.portfolioLinks.map((l) => (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-3 px-5 py-3 text-[14px] text-mist-100 hover:bg-ink-800/60">
                        <Link2 className="size-4 text-mist-400" aria-hidden /> {l.label}
                        <span className="ml-auto truncate text-[12.5px] text-mist-500">{l.url.replace(/^https?:\/\//, "")}</span>
                        <ExternalLink className="size-3.5 text-mist-500" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel>
              <PanelHeader title="Verified payment history" description="Milestone payments to this wallet, decoded from EscrowFlow contract events." />
              {d.history.payments.length === 0 ? (
                <p className="px-5 py-6 text-[14px] text-mist-400">No EscrowFlow payments to this wallet yet.</p>
              ) : (
                <ul className="divide-y divide-ink-700">
                  {d.history.payments.map((p) => (
                    <li key={p.txHash + p.milestoneIndex} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px]">
                      <Link href={`/escrow/${p.chainProjectId}`} className="text-mist-100 hover:text-signal-300">Escrow #{p.chainProjectId} · M{p.milestoneIndex + 1}</Link>
                      <span className="text-mist-500">{p.at ? formatDate(p.at, true) : ""}</span>
                      <TxLink hash={p.txHash} />
                      <Amount wei={p.amountWei} className="ml-auto text-paid-300" />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Client feedback" description="User-submitted reviews from completed EscrowFlow projects — opinions, not verified facts." />
              {d.reviews.length === 0 ? (
                <EmptyState icon={<Star className="size-5" />} title="No reviews yet" description="Only participants of a completed project can leave one review each." />
              ) : (
                <ul className="divide-y divide-ink-700">
                  {d.reviews.map((r, i) => (
                    <li key={i} className="px-5 py-4">
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className="text-warn-300" aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}<span className="text-ink-500">{"★".repeat(5 - r.rating)}</span></span>
                        <span className="font-mono text-[12px] text-mist-500">{shortAddress(r.reviewer)}</span>
                        <span className="text-mist-500">{formatDate(r.created_at)}</span>
                      </div>
                      {r.body && <p className="mt-1 text-[14px] text-mist-200">{r.body}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          <aside className="space-y-6">
            <Panel className="p-5">
              <div className="mb-4 flex items-center gap-2 text-[13px] text-paid-300">
                <ShieldCheck className="size-4" aria-hidden /> Derived from the EscrowFlow contract only
              </div>
              <div className="grid grid-cols-2 gap-5">
                <Stat label="Received as freelancer" value={<Amount wei={d.history.freelancer.receivedWei} />} />
                <Stat label="Milestones paid" value={d.history.freelancer.milestonesPaid} />
                <Stat label="Funded projects" value={d.history.freelancer.projects} />
                <Stat label="Completed" value={d.history.freelancer.completed} />
              </div>
              <div className="mt-5 border-t border-ink-700 pt-4 text-[12.5px] leading-relaxed text-mist-400">
                As a client: {d.history.client.projectsFunded} funded escrows, {d.history.client.completed} completed, <Amount wei={d.history.client.releasedWei} /> released. Wallet history shows payments, not the quality of the work.
              </div>
            </Panel>
          </aside>
        </div>
      )}
    </PageContainer>
  );
}
