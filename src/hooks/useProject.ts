"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { api } from "@/lib/client/api";
import { reviveChain, type Note, type ProjectViewJson, type Submission } from "@/lib/client/types";
import { roleOf } from "@/lib/escrow-state";
import { useSession } from "./useSession";

export function useProject(id: string) {
  const { address } = useAccount();
  const q = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<ProjectViewJson>(`/api/projects/${id}`),
    refetchInterval: 20_000,
  });
  const chain = reviveChain(q.data?.chain);
  const role = chain ? roleOf(chain.project, address) : q.data?.access === "client" ? "client" : q.data?.access === "freelancer" ? "freelancer" : "viewer";
  return { ...q, view: q.data, chain, role, chainId: q.data?.project.chainProjectId ? BigInt(q.data.project.chainProjectId) : null };
}

export function useSubmissions(id: string, enabled = true) {
  const { isSignedIn } = useSession();
  return useQuery({
    queryKey: ["submissions", id],
    queryFn: () => api<{ submissions: Submission[] }>(`/api/projects/${id}/submissions`),
    enabled: enabled && isSignedIn,
    refetchInterval: 30_000,
  });
}

export function useNotes(id: string, enabled = true) {
  const { isSignedIn } = useSession();
  return useQuery({
    queryKey: ["notes", id],
    queryFn: () => api<{ notes: Note[] }>(`/api/projects/${id}/notes`),
    enabled: enabled && isSignedIn,
    refetchInterval: 30_000,
  });
}
