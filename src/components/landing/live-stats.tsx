"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { formatMusd } from "@/lib/money";
import { ESCROW_ADDRESS } from "@/config/contracts";
import { explorerAddress } from "@/config/chains";

interface Stats {
  blockNumber: string;
  musdTotalSupplyWei: string;
  escrowProjects: string;
  escrowHeldWei: string;
  escrowBalanceWei: string;
  fetchedAt: string;
}

/** Real numbers read from Mezo testnet right now — no marketing counters. */
export function LiveStats() {
  const q = useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/api/stats"), refetchInterval: 20_000 });
  const d = q.data;
  const cells = [
    { label: "Escrows created on this contract", value: d ? Number(d.escrowProjects).toLocaleString("en-US") : null },
    { label: "MUSD held in escrow now", value: d ? formatMusd(BigInt(d.escrowHeldWei)) : null },
    { label: "MUSD total supply (testnet)", value: d ? formatMusd(BigInt(d.musdTotalSupplyWei), { maxDecimals: 0, minDecimals: 0 }) : null },
    { label: "Mezo testnet block", value: d ? Number(d.blockNumber).toLocaleString("en-US") : null },
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-ink-700 bg-ink-700 lg:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="bg-ink-850 px-5 py-4">
            <dt className="text-[12.5px] text-mist-400">{c.label}</dt>
            <dd className="amount mt-1 text-[22px] font-semibold tracking-[-0.01em] text-white">{c.value ?? <span className="inline-block h-6 w-24 animate-pulse-soft rounded bg-ink-700" />}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[12px] text-mist-500">
        Read live from Mezo Testnet{d ? ` at ${new Date(d.fetchedAt).toLocaleTimeString("en-GB")}` : ""} ·{" "}
        <a href={explorerAddress(ESCROW_ADDRESS)} target="_blank" rel="noopener noreferrer" className="text-signal-300 hover:underline">
          EscrowFlow contract
        </a>
      </p>
    </div>
  );
}
