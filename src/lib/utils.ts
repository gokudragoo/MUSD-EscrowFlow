import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddress(a?: string | null, chars = 4) {
  if (!a) return "";
  return `${a.slice(0, 2 + chars)}…${a.slice(-chars)}`;
}

export function shortHash(h?: string | null) {
  if (!h) return "";
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "in 3 days", "2 hours ago" from a unix-seconds or Date/ISO input. */
export function relativeTime(at: number | string | Date, now = Date.now()) {
  const t = typeof at === "number" ? at * 1000 : new Date(at).getTime();
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return diff >= 0 ? "in a few seconds" : "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 30 * 86_400) return rtf.format(Math.round(diff / 86_400), "day");
  return rtf.format(Math.round(diff / (30 * 86_400)), "month");
}

export function formatDate(at: number | string | Date, withTime = false) {
  const d = typeof at === "number" ? new Date(at * 1000) : new Date(at);
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

/** Human duration for review periods / grace periods (seconds). */
export function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) {
    const h = Math.round(seconds / 3600);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round((seconds / 86_400) * 10) / 10;
  return `${d} day${d === 1 ? "" : "s"}`;
}

export function countdown(toUnix: number, now = Math.floor(Date.now() / 1000)) {
  let s = Math.max(0, toUnix - now);
  const d = Math.floor(s / 86_400);
  s -= d * 86_400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
