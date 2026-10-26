"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "release";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-signal-500 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.18)_inset,0_10px_24px_-12px_rgb(61_123_255/0.9)] hover:bg-signal-400 active:bg-signal-600",
  release:
    "bg-paid-400 text-ink-950 shadow-[0_1px_0_0_rgb(255_255_255/0.3)_inset,0_10px_24px_-12px_rgb(47_198_246/0.8)] hover:bg-paid-300",
  secondary: "bg-ink-700 text-mist-100 border border-ink-600 hover:bg-ink-600 hover:border-ink-500",
  outline: "border border-ink-600 text-mist-100 hover:border-signal-400 hover:text-white bg-transparent",
  ghost: "text-mist-300 hover:text-white hover:bg-ink-750",
  danger: "bg-danger-400/12 text-danger-300 border border-danger-400/40 hover:bg-danger-400/20",
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
  { className, variant = "primary", size = "md", loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-[10px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
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
