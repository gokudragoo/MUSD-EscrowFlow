"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Link2, FileText } from "lucide-react";
import { explorerAddress, explorerTx } from "@/config/chains";
import { formatMusd } from "@/lib/money";
import { cn, shortAddress, shortHash } from "@/lib/utils";

/** MUSD amount with tabular numerals. Accepts bigint or a decimal-string of base units. */
export function Amount({ wei, className, symbol = true, decimals = 2, muted }: { wei: bigint | string; className?: string; symbol?: boolean; decimals?: number; muted?: boolean }) {
  const v = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  return (
    <span className={cn("amount whitespace-nowrap", className)}>
      {formatMusd(v, { maxDecimals: decimals })}
      {symbol && <span className={cn("ml-1 text-[0.82em] font-medium", muted ? "text-mist-500" : "text-mist-400")}>MUSD</span>}
    </span>
  );
}

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      className={cn("rounded p-1 text-mist-400 hover:bg-ink-700 hover:text-white", className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          // clipboard unavailable
        }
      }}
    >
      {done ? <Check className="size-3.5 text-paid-300" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function AddressChip({ address, label, link = true, className }: { address?: string | null; label?: string | null; link?: boolean; className?: string }) {
  if (!address) return <span className="text-mist-500">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 align-middle", className)}>
      <span className="font-mono text-[12.5px] text-mist-100" title={address}>
        {label ? <span className="font-sans text-[13.5px]">{label}</span> : shortAddress(address)}
      </span>
      <CopyButton value={address} label="Copy address" />
      {link && (
        <a href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" className="rounded p-1 text-mist-400 hover:bg-ink-700 hover:text-white" aria-label="View address on Mezo explorer">
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </span>
  );
}

export function TxLink({ hash, className, label }: { hash?: string | null; className?: string; label?: string }) {
  if (!hash) return null;
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 font-mono text-[12.5px] text-signal-300 hover:text-signal-300 hover:underline", className)}
    >
      {label ?? shortHash(hash)}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

export function HashText({ value, className }: { value?: string | null; className?: string }) {
  if (!value) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="font-mono text-[12.5px] text-mist-300" title={value}>
        {shortHash(value)}
      </span>
      <CopyButton value={value} label="Copy hash" />
    </span>
  );
}

/** Distinguishes verified chain facts from application records everywhere they appear. */
export function SourceTag({ source }: { source: "chain" | "app" }) {
  return source === "chain" ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-paid-400/30 bg-paid-400/10 px-2 py-0.5 text-[11.5px] font-medium text-paid-300">
      <Link2 className="size-3" aria-hidden /> On-chain fact
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-ink-600 bg-ink-750 px-2 py-0.5 text-[11.5px] font-medium text-mist-300">
      <FileText className="size-3" aria-hidden /> Application record
    </span>
  );
}
