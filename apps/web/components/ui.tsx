import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { cx, severityTone } from "@/lib/format";

export function Card({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <section className={cx("rounded-lg border border-[#24324a] bg-[#0d1728]/88 shadow-[0_18px_50px_rgba(0,0,0,0.22)]", className)}>{children}</section>;
}

export function Badge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "neutral" | "success" | "warn" | "danger" | "info" }>) {
  const tones = {
    neutral: "border-slate-400/30 bg-slate-500/10 text-slate-200",
    success: "border-emerald-300/40 bg-emerald-400/12 text-emerald-100",
    warn: "border-amber-300/40 bg-amber-400/12 text-amber-100",
    danger: "border-red-300/40 bg-red-400/12 text-red-100",
    info: "border-cyan-300/40 bg-cyan-400/12 text-cyan-100"
  };
  return <span className={cx("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={cx("inline-flex min-w-20 justify-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize", severityTone(severity))}>{severity}</span>;
}

export function Button({
  children,
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const variants = {
    primary: "bg-[#43c6ac] text-[#07111f] hover:bg-[#65d8c2]",
    secondary: "border border-[#31445f] bg-[#142238] text-slate-100 hover:bg-[#1b2b45]",
    danger: "border border-red-400/40 bg-red-500/15 text-red-100 hover:bg-red-500/22",
    ghost: "text-slate-300 hover:bg-white/8"
  };
  return (
    <button
      {...props}
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[#31445f] bg-[#0a1424] p-8 text-center">
      <p className="text-base font-semibold text-slate-100">{title}</p>
      <p className="mt-2 text-sm text-slate-400">{body}</p>
    </div>
  );
}

export function FieldLabel({ children }: PropsWithChildren) {
  return <span className="text-sm font-medium text-slate-200">{children}</span>;
}
