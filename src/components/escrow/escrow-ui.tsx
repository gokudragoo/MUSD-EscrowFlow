"use client";

import type { ReactNode } from "react";
import { CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import {
  MILESTONE_DISPLAY_LABEL,
  MILESTONE_DISPLAY_TONE,
  MilestoneStatus,
  type Ledger,
  type MilestoneDisplay,
} from "@/lib/escrow-state";
import { basisPoints } from "@/lib/money";
import { cn, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";
import { Amount, SourceTag, TxLink } from "@/components/ui/chain";
import type { TimelineItem } from "@/lib/client/types";

const SEGMENT_CLASS: Record<number, string> = {
  [MilestoneStatus.Pending]: "bg-held-400/75",
  [MilestoneStatus.Submitted]: "bg-held-300 ring-2 ring-inset ring-signal-400",
  [MilestoneStatus.ChangesRequested]: "bg-held-400/55",
  [MilestoneStatus.Disputed]: "hatch-warn",
  [MilestoneStatus.Released]: "bg-paid-400",
  [MilestoneStatus.Refunded]: "bg-refund-400",
  // Settled by a split: part paid, part refunded — shown as muted brass, never a gradient.
  [MilestoneStatus.Resolved]: "bg-paid-400/50",
};

/**
 * The escrow bar: one segment per milestone, width = its share of the budget, colour = where that
 * money is right now. Unfunded projects show outlined segments. Labels carry the state in text.
 */
export function EscrowBar({
  amounts,
  statuses,
  funded,
  pendingIndex,
  size = "md",
  showLegend,
}: {
  amounts: (bigint | string)[];
  statuses: number[] | null;
  funded: boolean;
  pendingIndex?: number | null;
  size?: "sm" | "md" | "lg";
  showLegend?: boolean;
}) {
  const values = amounts.map((a) => (typeof a === "bigint" ? a : BigInt(a)));
  const total = values.reduce((a, b) => a + b, 0n);
  const h = size === "sm" ? "h-2" : size === "lg" ? "h-4" : "h-3";
  return (
    <div>
      <div className={cn("flex w-full gap-[3px] overflow-hidden rounded-full", h)} role="img" aria-label={describeBar(values, statuses, funded)}>
        {values.map((v, i) => {
          const s = statuses?.[i];
          const cls = !funded || s === undefined ? "border border-dashed border-ink-500 bg-transparent" : pendingIndex === i ? "hatch-pending" : SEGMENT_CLASS[s];
          return <div key={i} className={cn("h-full min-w-[6px] first:rounded-l-full last:rounded-r-full", cls)} style={{ flexGrow: Math.max(basisPoints(v, total), 1) }} />;
        })}
      </div>
      {showLegend && (
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-mist-400">
          <LegendDot className="bg-held-400/75" label="Held in escrow" />
          <LegendDot className="bg-paid-400" label="Released to freelancer" />
          <LegendDot className="bg-refund-400" label="Refunded to client" />
          <LegendDot className="hatch-warn" label="Disputed (frozen)" />
          <LegendDot className="bg-held-300 ring-2 ring-inset ring-signal-400" label="Awaiting review" />
          {!funded && <LegendDot className="border border-dashed border-ink-500" label="Not funded yet" />}
        </div>
      )}
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2 w-3.5 rounded-sm", className)} aria-hidden />
      {label}
    </span>
  );
}

function describeBar(values: bigint[], statuses: number[] | null, funded: boolean) {
  if (!funded) return `${values.length} milestones, escrow not funded yet`;
  const names = ["pending", "submitted", "changes requested", "disputed", "paid", "refunded", "resolved"];
  return values.map((_, i) => `Milestone ${i + 1}: ${statuses ? names[statuses[i]] : "unknown"}`).join("; ");
}

export function MilestonePill({ display, className }: { display: MilestoneDisplay; className?: string }) {
  return (
    <Badge tone={MILESTONE_DISPLAY_TONE[display]} dot className={className}>
      {MILESTONE_DISPLAY_LABEL[display]}
    </Badge>
  );
}

export function ProjectStatusPill({ status, label }: { status: number | null; label: string }) {
  const tone = status === 3 ? "held" : status === 4 ? "released" : status === 5 ? "refunded" : status === null ? "neutral" : "info";
  return (
    <Badge tone={tone as never} dot>
      {label}
    </Badge>
  );
}

/** Total / held / released / refunded — read from contract state, with a reconciliation check. */
export function LedgerSummary({ ledger, reconciled, blockNumber, compact }: { ledger: Ledger; reconciled?: boolean; blockNumber?: string; compact?: boolean }) {
  const cells: { label: string; value: bigint; tone: string; hint: string }[] = [
    { label: "Agreed budget", value: ledger.total, tone: "text-white", hint: "Sum of all milestones" },
    { label: "Held in escrow", value: ledger.held, tone: "text-held-300", hint: "Locked in the contract, not yet earned" },
    { label: "Released", value: ledger.released, tone: "text-paid-300", hint: "Paid to the freelancer" },
    { label: "Refunded", value: ledger.refunded, tone: "text-mist-300", hint: "Returned to the client" },
  ];
  return (
    <div>
      <dl className={cn("grid gap-px overflow-hidden rounded-[12px] border border-ink-700 bg-ink-700", compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}>
        {cells.map((c) => (
          <div key={c.label} className="bg-ink-850 px-4 py-3">
            <dt className="text-[12px] text-mist-400">{c.label}</dt>
            <dd className={cn("amount mt-1 text-[19px] font-semibold tracking-[-0.01em]", c.tone)}>
              <Amount wei={c.value} />
            </dd>
            {!compact && <div className="mt-0.5 text-[11.5px] text-mist-500">{c.hint}</div>}
          </div>
        ))}
      </dl>
      {reconciled !== undefined && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-mist-400">
          {reconciled ? (
            <span className="inline-flex items-center gap-1 text-paid-300">
              <ShieldCheck className="size-3.5" aria-hidden /> Reconciled: funded = released + refunded + held
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-danger-300">
              <AlertTriangle className="size-3.5" aria-hidden /> Ledger does not reconcile — contact support
            </span>
          )}
          {blockNumber && <span>Read from contract at block {Number(blockNumber).toLocaleString("en-US")}</span>}
        </div>
      )}
    </div>
  );
}

export function Timeline({ items, milestoneTitles }: { items: TimelineItem[]; milestoneTitles?: string[] }) {
  if (items.length === 0) return <p className="px-5 py-6 text-[14px] text-mist-400">No activity yet.</p>;
  return (
    <ol className="relative space-y-0">
      {[...items].reverse().map((it, idx) => (
        <li key={`${it.at}-${idx}`} className="relative flex gap-3 px-5 py-3.5">
          <div className="relative flex flex-col items-center">
            <span className={cn("mt-1 grid size-5 place-items-center rounded-full border", it.source === "chain" ? "border-paid-400/50 bg-paid-400/10" : "border-ink-500 bg-ink-750")}>
              {it.source === "chain" ? <CheckCircle2 className="size-3 text-paid-300" aria-hidden /> : <span className="size-1.5 rounded-full bg-mist-400" />}
            </span>
            {idx < items.length - 1 && <span className="mt-1 w-px flex-1 bg-ink-700" aria-hidden />}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[14px] font-medium text-white">{it.title}</span>
              {it.milestoneIndex !== null && it.milestoneIndex !== undefined && (
                <span className="text-[13px] text-mist-400">M{it.milestoneIndex + 1}{milestoneTitles?.[it.milestoneIndex] ? ` · ${milestoneTitles[it.milestoneIndex]}` : ""}</span>
              )}
              <SourceTag source={it.source} />
            </div>
            {it.detail && <p className="mt-0.5 text-[13px] text-mist-300">{it.detail}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-mist-500">
              <time dateTime={it.at}>{formatDate(it.at, true)}</time>
              {it.txHash && <TxLink hash={it.txHash} />}
              {it.blockNumber && <span>block {Number(it.blockNumber).toLocaleString("en-US")}</span>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function KeyValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-[13.5px]">
      <dt className="shrink-0 text-mist-400">{label}</dt>
      <dd className="min-w-0 text-right text-mist-100">{children}</dd>
    </div>
  );
}
