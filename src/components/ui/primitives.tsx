import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Panel({ className, raised, ...props }: HTMLAttributes<HTMLDivElement> & { raised?: boolean }) {
  return <div className={cn(raised ? "panel-raised" : "panel", className)} {...props} />;
}

export function PanelHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-ink-700 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-white">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-mist-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="mb-2 text-[13px] text-mist-400">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.01em] text-white sm:text-[30px]">{title}</h1>
        {description && <p className="mt-2 text-[15px] leading-relaxed text-mist-300">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type BadgeTone = "neutral" | "held" | "released" | "refunded" | "warning" | "danger" | "info" | "signal";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-ink-700/80 text-mist-300 border-ink-600",
  held: "bg-held-500/15 text-held-300 border-held-400/35",
  released: "bg-paid-400/12 text-paid-300 border-paid-400/35",
  refunded: "bg-refund-400/12 text-mist-300 border-refund-400/30",
  warning: "bg-warn-400/12 text-warn-300 border-warn-400/35",
  danger: "bg-danger-400/12 text-danger-300 border-danger-400/35",
  info: "bg-signal-500/12 text-signal-300 border-signal-400/35",
  signal: "bg-signal-500/15 text-signal-300 border-signal-400/40",
};

export function Badge({ tone = "neutral", className, children, dot }: { tone?: BadgeTone; className?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-medium", badgeTones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Field({ label, hint, error, children, htmlFor, optional }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; optional?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-mist-100">
        <span>{label}</span>
        {optional && <span className="text-[12px] font-normal text-mist-500">Optional</span>}
      </label>
      {children}
      {error ? (
        <p className="text-[12.5px] text-danger-300" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-mist-400">{hint}</p>
      ) : null}
    </div>
  );
}

const control =
  "w-full rounded-[10px] border border-ink-600 bg-ink-950/60 px-3 text-[14px] text-mist-50 placeholder:text-mist-500 transition-colors focus:border-signal-400 focus:outline-none focus:ring-2 focus:ring-signal-500/25 disabled:opacity-60 aria-[invalid=true]:border-danger-400/70";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-[96px] py-2.5 leading-relaxed", className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(control, "h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238f9dbe' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...p}>
      {children}
    </select>
  );
});

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse-soft rounded-md bg-ink-700/70", className)} aria-hidden />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-ink-600 bg-ink-800 text-mist-300">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-mist-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[11px] font-medium text-mist-300">{children}</kbd>;
}

export function Notice({ tone = "info", title, children, icon, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string }) {
  const tones = {
    info: "border-signal-400/30 bg-signal-500/[0.07] text-mist-100",
    warning: "border-warn-400/35 bg-warn-400/[0.07] text-mist-100",
    danger: "border-danger-400/35 bg-danger-400/[0.07] text-mist-100",
    success: "border-paid-400/35 bg-paid-400/[0.07] text-mist-100",
  } as const;
  const iconTone = { info: "text-signal-300", warning: "text-warn-300", danger: "text-danger-300", success: "text-paid-300" } as const;
  return (
    <div className={cn("flex gap-3 rounded-[12px] border px-4 py-3 text-[13.5px] leading-relaxed", tones[tone], className)}>
      {icon && <div className={cn("mt-0.5 shrink-0", iconTone[tone])}>{icon}</div>}
      <div className="min-w-0">
        {title && <div className="font-semibold text-white">{title}</div>}
        {children && <div className={cn(title && "mt-0.5", "text-mist-300")}>{children}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[12.5px] text-mist-400">{label}</div>
      <div className="amount mt-1 truncate text-[22px] font-semibold tracking-[-0.01em] text-white">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-mist-500">{hint}</div>}
    </div>
  );
}
