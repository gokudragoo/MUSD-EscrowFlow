"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Link2 } from "lucide-react";
import { PageContainer, SignInGate } from "@/components/layout/gate";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel, Skeleton } from "@/components/ui/primitives";
import { TxLink } from "@/components/ui/chain";
import { api } from "@/lib/client/api";
import { cn, relativeTime } from "@/lib/utils";

interface N {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  source: "chain" | "app" | "reminder";
  tx_hash: string | null;
  read_at: string | null;
  created_at: string;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "project", label: "Project updates", kinds: ["invitation", "terms", "application", "comment", "completed", "cancellation"] },
  { key: "payment", label: "Payments", kinds: ["funding", "payment", "refund"] },
  { key: "deadline", label: "Deadlines", kinds: ["deadline"] },
  { key: "review", label: "Reviews and disputes", kinds: ["review", "dispute"] },
];

export default function NotificationsPage() {
  return (
    <SignInGate title="Sign in to see notifications">
      <PageContainer className="max-w-4xl">
        <Notifications />
      </PageContainer>
    </SignInGate>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ notifications: N[]; unread: number }>("/api/notifications") });
  const kinds = FILTERS.find((f) => f.key === filter)?.kinds;
  const list = (q.data?.notifications ?? []).filter((n) => !kinds || kinds.includes(n.kind));
  const markAll = async () => {
    await api("/api/notifications/read", { method: "POST", json: { all: true } });
    await qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Payment notifications are created only from verified on-chain events. Deadline reminders are sent once a day; open the app for live status."
        actions={<Button size="sm" variant="secondary" disabled={!q.data?.unread} onClick={markAll}>Mark all as read</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} className={cn("rounded-full border px-3 py-1 text-[13px]", filter === f.key ? "border-signal-400 bg-signal-500/15 text-white" : "border-ink-600 text-mist-300 hover:text-white")}>
            {f.label}
          </button>
        ))}
      </div>
      {q.isLoading && <Skeleton className="h-64" />}
      {q.data && list.length === 0 && (
        <Panel>
          <EmptyState icon={<Bell className="size-5" />} title="Nothing here yet" description="Invitations, funding confirmations, review requests and payments will show up here." />
        </Panel>
      )}
      {list.length > 0 && (
        <Panel>
          <ul className="divide-y divide-ink-700">
            {list.map((n) => (
              <li key={n.id} className={cn("flex gap-3 px-5 py-4", !n.read_at && "bg-signal-500/[0.04]")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-signal-400")} aria-label={n.read_at ? undefined : "Unread"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.href ? (
                      <Link
                        href={n.href}
                        className="text-[14px] font-medium text-white hover:text-signal-300"
                        onClick={() => api("/api/notifications/read", { method: "POST", json: { ids: [n.id] } }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] }))}
                      >
                        {n.title}
                      </Link>
                    ) : (
                      <span className="text-[14px] font-medium text-white">{n.title}</span>
                    )}
                    {n.source === "chain" && <Badge tone="released"><Link2 className="size-3" /> Verified on-chain</Badge>}
                    {n.source === "reminder" && <Badge tone="warning">Reminder</Badge>}
                  </div>
                  {n.body && <p className="mt-0.5 text-[13.5px] text-mist-300">{n.body}</p>}
                  <div className="mt-1 flex items-center gap-3 text-[12px] text-mist-500">
                    {relativeTime(n.created_at)}
                    {n.tx_hash && <TxLink hash={n.tx_hash} />}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
