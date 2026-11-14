"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { formatMusd } from "@/lib/money";

interface Stats {
  blockNumber: string;
  musdTotalSupplyWei: string;
  escrowProjects: string;
  escrowHeldWei: string;
  escrowInSavingsWei: string;
  releasedWei: string;
  uniqueWallets: number;
  fetchedAt: string;
}

/** Real numbers read from Mezo testnet right now — no marketing counters. */
export function LiveStats() {
  const q = useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/api/stats"), refetchInterval: 20_000 });
  const d = q.data;
  const cells = [
    { label: "Escrows created", value: d ? Number(d.escrowProjects).toLocaleString("en-US") : null },
    { label: "MUSD held in escrow now", value: d ? formatMusd(BigInt(d.escrowHeldWei)) : null },
    { label: "Of which earning in sMUSD", value: d ? formatMusd(BigInt(d.escrowInSavingsWei)) : null },
    { label: "MUSD paid to freelancers", value: d ? formatMusd(BigInt(d.releasedWei)) : null },
    { label: "Distinct wallets", value: d ? d.uniqueWallets.toLocaleString("en-US") : null },
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-ink-700 bg-ink-700 md:grid-cols-3 lg:grid-cols-5">
        {cells.map((c) => (
          <div key={c.label} className="bg-ink-850 px-5 py-4">
            <dt className="text-[12.5px] text-mist-400">{c.label}</dt>
            <dd className="amount mt-1 text-[22px] font-semibold tracking-[-0.01em] text-white">
              {c.value ?? (q.isError ? <span className="text-[14px] font-normal text-mist-500">Unavailable</span> : <span className="inline-block h-6 w-24 animate-pulse-soft rounded bg-ink-700" />)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-mist-500">
        <span>
          Read live from Mezo Testnet{d ? ` at block ${Number(d.blockNumber).toLocaleString("en-US")}` : ""}.
        </span>
        <Link href="/activity" className="text-signal-300 hover:underline">
          See every escrow
        </Link>
      </p>
    </div>
  );
}
