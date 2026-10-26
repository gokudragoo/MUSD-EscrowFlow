"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useMediaQuery, useMounted } from "@/hooks/useClient";
import { cn } from "@/lib/utils";

const VaultScene = dynamic(() => import("./vault-scene"), { ssr: false, loading: () => <VaultPoster /> });

const STEPS = [
  { label: "UI design", amount: "40" },
  { label: "Frontend", amount: "60" },
  { label: "Backend", amount: "60" },
  { label: "Final delivery", amount: "40" },
];

function canWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function HeroVisual() {
  const mounted = useMounted();
  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)");
  const small = useMediaQuery("(max-width: 640px)");
  const webgl = useMemo(() => (mounted ? canWebGL() : false), [mounted]);
  const mode: "pending" | "scene" | "poster" = !mounted ? "pending" : !reduce && !small && webgl ? "scene" : "poster";
  const [step, setStep] = useState(0);
  const released = STEPS.slice(0, step).reduce((a, s) => a + Number(s.amount), 0);
  return (
    <div className="relative aspect-[5/4] w-full sm:aspect-[4/3] lg:aspect-auto lg:h-full">
      {mode === "scene" ? <VaultScene onStep={setStep} /> : <VaultPoster />}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-wrap items-end justify-between gap-3 px-2 text-[12px]">
        <div className="glass rounded-[10px] px-3 py-2">
          <div className="text-mist-400">Escrow (illustrative)</div>
          <div className="amount mt-0.5 text-[13px] text-mist-100">
            <span className="text-held-300">{200 - (mode === "scene" ? released : 0)} held</span>
            <span className="mx-1.5 text-mist-500">/</span>
            <span className="text-paid-300">{mode === "scene" ? released : 0} released</span>
            <span className="ml-1 text-mist-500">MUSD</span>
          </div>
        </div>
        <ol className="glass hidden gap-1.5 rounded-[10px] px-2.5 py-2 sm:flex" aria-label="Milestones">
          {STEPS.map((s, i) => (
            <li key={s.label} className={cn("rounded-md px-2 py-1 transition-colors", mode === "scene" && i < step ? "bg-paid-400/15 text-paid-300" : "text-mist-400")}>
              M{i + 1} · {s.amount}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Static rendering of the same composition (reduced motion, small screens, no WebGL). */
export function VaultPoster() {
  return (
    <svg viewBox="0 0 520 400" className="absolute inset-0 h-full w-full" role="img" aria-label="An escrow vault holding MUSD, locked by four milestone rings, with released tokens flowing to the freelancer">
      <defs>
        <radialGradient id="core" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#b3aeff" />
          <stop offset="70%" stopColor="#6f66f2" />
          <stop offset="100%" stopColor="#3b3596" />
        </radialGradient>
        <linearGradient id="glass" x1="0" x2="1">
          <stop offset="0%" stopColor="#9fb5ff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#9fb5ff" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <rect x="110" y="70" width="150" height="260" rx="75" fill="url(#glass)" stroke="#5b92ff" strokeOpacity="0.35" />
      <circle cx="185" cy="200" r="54" fill="url(#core)" />
      {[0, 1, 2, 3].map((i) => (
        <ellipse key={i} cx="185" cy={130 + i * 46} rx="92" ry="18" fill="none" stroke={i === 0 ? "#2fc6f6" : "#8b83ff"} strokeWidth="5" strokeDasharray={i === 0 ? "0" : "520 40"} opacity={i === 0 ? 0.75 : 0.95} />
      ))}
      <path d="M215 175 C 280 70, 360 110, 420 230" fill="none" stroke="#2fc6f6" strokeOpacity="0.5" strokeWidth="2" strokeDasharray="4 8" />
      {[0.25, 0.45, 0.65, 0.82].map((t, i) => {
        const x = (1 - t) ** 3 * 215 + 3 * (1 - t) ** 2 * t * 280 + 3 * (1 - t) * t * t * 360 + t ** 3 * 420;
        const y = (1 - t) ** 3 * 175 + 3 * (1 - t) ** 2 * t * 70 + 3 * (1 - t) * t * t * 110 + t ** 3 * 230;
        return <ellipse key={i} cx={x} cy={y} rx="9" ry="4" fill="#2fc6f6" />;
      })}
      <ellipse cx="430" cy="270" rx="44" ry="12" fill="#1b2950" stroke="#34477a" />
      <circle cx="430" cy="245" r="17" fill="#2fc6f6" />
    </svg>
  );
}
