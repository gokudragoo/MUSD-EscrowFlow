"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "release";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  // Brass is the only filled accent; dark text keeps it above 8:1 contrast.
  primary: "bg-signal-500 text-ink-950 hover:bg-signal-400 active:bg-signal-600",
  release: "bg-signal-500 text-ink-950 hover:bg-signal-400 active:bg-signal-600",
  secondary: "bg-ink-750 text-mist-100 border border-ink-600 hover:bg-ink-700 hover:border-ink-500",
  outline: "border border-ink-600 text-mist-100 hover:border-mist-400 hover:text-white bg-transparent",
  ghost: "text-mist-300 hover:text-white hover:bg-ink-750",
  danger: "bg-danger-400/10 text-danger-300 border border-danger-400/45 hover:bg-danger-400/20",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-[15px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-[8px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
