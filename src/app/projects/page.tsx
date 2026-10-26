"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Plus } from "lucide-react";
import { PageContainer, SignInGate } from "@/components/layout/gate";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Notice, PageHeader, Panel, Skeleton } from "@/components/ui/primitives";
import { Amount } from "@/components/ui/chain";
import { EscrowBar, ProjectStatusPill } from "@/components/escrow/escrow-ui";
import { api } from "@/lib/client/api";
import { formatDate } from "@/lib/utils";

interface Item {
  id: string;
  title: string;
  category: string;
  budgetWei: string;
  milestoneCount: number;
  finalDeadline: string;
  listingStatus: string;
  role: "client" | "freelancer" | "applicant";
  chainProjectId: string | null;
  chainStatus: number | null;
  chainStatusLabel: string;
  ledger: Record<string, string> | null;
  milestoneStatuses: number[] | null;
  milestoneAmounts: string[];
  updatedAt: string;
}

export default function ProjectsPage() {
  return (
    <SignInGate title="Sign in to see your projects">
      <PageContainer>
        <ProjectsList />
      </PageContainer>
    </SignInGate>
  );
}

function ProjectsList() {
  const q = useQuery({ queryKey: ["my-projects"], queryFn: () => api<{ projects: Item[] }>("/api/projects") });
  return (
    <div>
      <PageHeader
        title="Projects"
        description="Every agreement you are part of — as client, freelancer or applicant."
        actions={
          <Link href="/projects/new">
            <Button size="sm">
              <Plus className="size-4" aria-hidden /> New project
            </Button>
          </Link>
        }
      />
      {q.isLoading && <Skeleton className="h-64" />}
      {q.error && <Notice tone="danger" title="Could not load projects">{(q.error as Error).message}</Notice>}
      {q.data && q.data.projects.length === 0 && (
        <Panel>
          <EmptyState icon={<Briefcase className="size-5" />} title="No projects yet" description="Create your first milestone escrow, or apply to an open listing." action={<Link href="/projects/new"><Button>Create a project</Button></Link>} />
        </Panel>
      )}
      {q.data && q.data.projects.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data.projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="panel block p-5 transition-colors hover:border-ink-500">
              <div className="flex flex-wrap items-center gap-2">
                <ProjectStatusPill status={p.chainStatus} label={p.chainStatusLabel} />
                <Badge>{p.role === "client" ? "You are the client" : p.role === "freelancer" ? "You are the freelancer" : "You applied"}</Badge>
                {p.chainProjectId && <span className="ml-auto text-[12px] text-mist-500">Escrow #{p.chainProjectId}</span>}
              </div>
              <h2 className="mt-3 text-[16px] font-semibold text-white">{p.title}</h2>
              <div className="mt-1 text-[13px] text-mist-400">
                {p.category} · {p.milestoneCount} milestones · final deadline {formatDate(p.finalDeadline)}
              </div>
              <div className="mt-4">
                <EscrowBar amounts={p.milestoneAmounts} statuses={p.milestoneStatuses} funded={!!p.ledger && BigInt(p.ledger.funded) > 0n} size="sm" />
              </div>
              <div className="mt-3 flex flex-wrap justify-between gap-2 text-[13px]">
                <span className="text-mist-400">Budget <Amount wei={p.budgetWei} className="text-mist-100" /></span>
                {p.ledger && (
                  <span className="text-mist-400">
                    <Amount wei={p.ledger.held} className="text-held-300" /> held · <Amount wei={p.ledger.released} className="text-paid-300" /> released
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
