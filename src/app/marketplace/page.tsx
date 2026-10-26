"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Store, UserRound } from "lucide-react";
import { PageContainer } from "@/components/layout/gate";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Input, PageHeader, Panel, Select, Skeleton } from "@/components/ui/primitives";
import { Amount } from "@/components/ui/chain";
import { EscrowBar } from "@/components/escrow/escrow-ui";
import { Avatar } from "@/components/ui/avatar";
import { api } from "@/lib/client/api";
import { CATEGORIES } from "@/lib/validation";
import type { Profile } from "@/lib/client/types";
import { cn, formatDate, relativeTime, shortAddress } from "@/lib/utils";

interface Listing {
  id: string;
  title: string;
  summary: string;
  category: string;
  skills: string[];
  budgetWei: string;
  milestoneCount: number;
  milestones: { title: string; amount: string; deadline: number }[];
  finalDeadline: string;
  status: string;
  client: string;
  clientName: string | null;
  applications: number;
  createdAt: string;
  rules: { autoRelease: boolean; deadlineReclaim: boolean; arbiter: boolean };
}

export default function MarketplacePage() {
  return (
    <PageContainer>
      <PageHeader
        title="Marketplace"
        description="Open projects looking for a freelancer, and freelancers who have published a profile. Profile details are self-reported; payment history comes from the contract."
        actions={
          <Link href="/projects/new">
            <Button size="sm">Post a project</Button>
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Marketplace />
      </Suspense>
    </PageContainer>
  );
}

function Marketplace() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = sp.get("tab") === "freelancers" ? "freelancers" : "projects";
  return (
    <div>
      <div className="mb-5 flex gap-1 border-b border-ink-700" role="tablist">
        {(["projects", "freelancers"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => router.replace(t === "projects" ? "/marketplace" : "/marketplace?tab=freelancers")}
            className={cn("-mb-px border-b-2 px-3 py-2.5 text-[14px] font-medium", tab === t ? "border-signal-400 text-white" : "border-transparent text-mist-400 hover:text-white")}
          >
            {t === "projects" ? "Open projects" : "Freelancers"}
          </button>
        ))}
      </div>
      {tab === "projects" ? <Listings /> : <Freelancers />}
    </div>
  );
}

function Listings() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [minBudget, setMin] = useState("");
  const [maxBudget, setMax] = useState("");
  const [deadlineBefore, setDeadline] = useState("");
  const [status, setStatus] = useState("open");
  const [sort, setSort] = useState("newest");
  const params = new URLSearchParams({ q, category, minBudget, maxBudget, deadlineBefore, status, sort });
  const data = useQuery({ queryKey: ["marketplace", params.toString()], queryFn: () => api<{ listings: Listing[] }>(`/api/marketplace?${params}`) });
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Panel className="h-fit space-y-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-500" aria-hidden />
          <Input aria-label="Search projects" placeholder="Title, keyword or skill" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <label className="block text-[12.5px] text-mist-400">
          Category
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[12.5px] text-mist-400">
            Min MUSD
            <Input inputMode="decimal" value={minBudget} onChange={(e) => setMin(e.target.value)} className="mt-1" />
          </label>
          <label className="text-[12.5px] text-mist-400">
            Max MUSD
            <Input inputMode="decimal" value={maxBudget} onChange={(e) => setMax(e.target.value)} className="mt-1" />
          </label>
        </div>
        <label className="block text-[12.5px] text-mist-400">
          Final deadline before
          <Input type="date" value={deadlineBefore} onChange={(e) => setDeadline(e.target.value)} className="mt-1" />
        </label>
        <label className="block text-[12.5px] text-mist-400">
          Status
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1">
            <option value="open">Open for applications</option>
            <option value="hired">Freelancer selected</option>
            <option value="all">All listings</option>
          </Select>
        </label>
        <label className="block text-[12.5px] text-mist-400">
          Sort by
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="mt-1">
            <option value="newest">Newest</option>
            <option value="budget_desc">Highest budget</option>
            <option value="deadline">Soonest deadline</option>
          </Select>
        </label>
      </Panel>
      <div className="min-w-0">
        {data.isLoading && <Skeleton className="h-64" />}
        {data.data && data.data.listings.length === 0 && (
          <Panel>
            <EmptyState icon={<Store className="size-5" />} title="No listings match" description="Try different filters, or post your own project as an open listing." action={<Link href="/projects/new"><Button variant="outline">Post a project</Button></Link>} />
          </Panel>
        )}
        <div className="space-y-4">
          {data.data?.listings.map((l) => (
            <Link key={l.id} href={`/projects/${l.id}`} className="panel block p-5 transition-colors hover:border-ink-500">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={l.status.startsWith("Open") ? "info" : "neutral"}>{l.status}</Badge>
                <Badge>{l.category}</Badge>
                <span className="ml-auto text-[12.5px] text-mist-500">Posted {relativeTime(l.createdAt)}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold text-white">{l.title}</h2>
                  {l.summary && <p className="mt-1 text-[14px] text-mist-300">{l.summary}</p>}
                </div>
                <Amount wei={l.budgetWei} className="text-[18px] font-semibold text-white" />
              </div>
              <div className="mt-4">
                <EscrowBar amounts={l.milestones.map((m) => m.amount)} statuses={null} funded={false} size="sm" />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-mist-400">
                <span>{l.milestoneCount} milestones</span>
                <span>Final deadline {formatDate(l.finalDeadline)}</span>
                <span>Client {l.clientName ?? shortAddress(l.client)}</span>
                <span>{l.applications} applications</span>
                {l.rules.autoRelease && <span>Auto-release</span>}
                {l.rules.arbiter && <span>Arbiter named</span>}
              </div>
              {l.skills.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {l.skills.map((s) => (
                    <span key={s} className="rounded-md bg-ink-700 px-2 py-0.5 text-[12px] text-mist-300">{s}</span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Freelancers() {
  const [q, setQ] = useState("");
  const data = useQuery({ queryKey: ["freelancers", q], queryFn: () => api<{ profiles: Profile[] }>(`/api/profiles?role=freelancer&q=${encodeURIComponent(q)}`) });
  return (
    <div>
      <div className="relative mb-5 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-500" aria-hidden />
        <Input aria-label="Search freelancers" placeholder="Name, skill or keyword" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>
      {data.isLoading && <Skeleton className="h-48" />}
      {data.data && data.data.profiles.length === 0 && (
        <Panel>
          <EmptyState icon={<UserRound className="size-5" />} title="No freelancer profiles found" description="Freelancers appear here after they publish a profile in Settings." />
        </Panel>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.data?.profiles.map((p) => (
          <Link key={p.address} href={`/freelancers/${p.address}`} className="panel block p-5 transition-colors hover:border-ink-500">
            <div className="flex items-center gap-3">
              <Avatar url={p.avatarUrl} name={p.displayName} />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-white">{p.displayName}</div>
                <div className="truncate text-[13px] text-mist-400">{p.headline || "Freelancer"}</div>
              </div>
              {p.available && <Badge tone="released" className="ml-auto">Available</Badge>}
            </div>
            {p.skills.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {p.skills.slice(0, 6).map((s) => (
                  <span key={s} className="rounded-md bg-ink-700 px-2 py-0.5 text-[12px] text-mist-300">{s}</span>
                ))}
              </div>
            )}
            <div className="mt-4 font-mono text-[12px] text-mist-500">{shortAddress(p.address, 6)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
