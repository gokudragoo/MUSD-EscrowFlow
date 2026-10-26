"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageContainer, SignInGate } from "@/components/layout/gate";
import { Notice, PageHeader, Skeleton } from "@/components/ui/primitives";
import { ProjectForm } from "@/components/project/project-form";
import { api } from "@/lib/client/api";
import { termsToDraft } from "@/lib/validation";
import type { ProjectViewJson } from "@/lib/client/types";

export default function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ["project", id], queryFn: () => api<ProjectViewJson>(`/api/projects/${id}`) });
  const v = q.data;
  return (
    <SignInGate>
      <PageContainer>
        <PageHeader
          eyebrow="Edit terms"
          title={v?.project.title ?? "Edit terms"}
          description="Edits create a new terms revision. If the escrow already exists on-chain you will commit the new version with a transaction, and the freelancer must accept it again before funding."
        />
        {q.isLoading && <Skeleton className="h-96" />}
        {q.error && <Notice tone="danger" title="Could not load this project">{(q.error as Error).message}</Notice>}
        {v && v.access !== "client" && <Notice tone="warning" title="Only the client can edit the terms" />}
        {v && v.access === "client" && v.terms && (
          <ProjectForm
            mode="edit"
            projectId={id}
            lockHiring={!!v.project.chainProjectId}
            initial={termsToDraft(v.terms, v.project.hiringMode ?? "direct", v.project.skills ?? [])}
          />
        )}
      </PageContainer>
    </SignInGate>
  );
}
