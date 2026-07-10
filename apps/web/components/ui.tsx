"use client";

import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type ComponentPropsWithoutRef, type PropsWithChildren } from "react";
import { AlertCircle, CheckCircle2, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { cx, severityTone } from "@/lib/format";

export function Card({ children, className, ...props }: PropsWithChildren<ComponentPropsWithoutRef<"section">>) {
  return <section {...props} className={cx("min-w-0 rounded-lg border border-[#24324a] bg-[#0d1728]/88 shadow-[0_18px_50px_rgba(0,0,0,0.22)]", className)}>{children}</section>;
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

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }>(function Button({
  children,
  className,
  variant = "primary",
  ...props
}, ref) {
  const variants = {
    primary: "bg-[#43c6ac] text-[#07111f] hover:bg-[#65d8c2]",
    secondary: "border border-[#31445f] bg-[#142238] text-slate-100 hover:bg-[#1b2b45]",
    danger: "border border-red-400/40 bg-red-500/15 text-red-100 hover:bg-red-500/22",
    ghost: "text-slate-300 hover:bg-white/8"
  };
  return (
    <button
      ref={ref}
      {...props}
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7de8d2] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09111f] disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
});

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

export function AlertBanner({
  title,
  children,
  tone = "info",
  onDismiss
}: PropsWithChildren<{
  title?: string;
  tone?: "info" | "success" | "warning" | "danger";
  onDismiss?: () => void;
}>) {
  const styles = {
    info: "border-sky-300/35 bg-sky-400/10 text-sky-100",
    success: "border-emerald-300/35 bg-emerald-400/10 text-emerald-100",
    warning: "border-amber-300/35 bg-amber-400/10 text-amber-100",
    danger: "border-red-300/40 bg-red-500/12 text-red-100"
  };
  const Icon = tone === "success" ? CheckCircle2 : tone === "warning" ? TriangleAlert : tone === "danger" ? AlertCircle : Info;
  return (
    <div className={cx("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", styles[tone])} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={cx("leading-6", title && "mt-1")}>{children}</div>
      </div>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="rounded p-1 opacity-75 transition hover:bg-white/10 hover:opacity-100" aria-label="Dismiss message">
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function LoadingPanel({ label = "Loading data" }: { label?: string }) {
  return (
    <Card className="overflow-hidden" aria-busy="true">
      <div className="flex items-center gap-3 border-b border-[#24324a] px-5 py-4 text-sm text-slate-300">
        <LoaderCircle className="h-4 w-4 animate-spin text-[#43c6ac]" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-3">
        <div className="h-24 animate-pulse rounded-md bg-[#132238]" />
        <div className="h-24 animate-pulse rounded-md bg-[#132238]" />
        <div className="h-24 animate-pulse rounded-md bg-[#132238]" />
      </div>
      <div className="space-y-3 px-5 pb-5">
        <div className="h-14 animate-pulse rounded-md bg-[#101b2d]" />
        <div className="h-14 animate-pulse rounded-md bg-[#101b2d]" />
        <div className="h-14 animate-pulse rounded-md bg-[#101b2d]" />
      </div>
    </Card>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children
}: PropsWithChildren<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
      if (event.key === "Tab") trapFocus(event, dialogRef.current);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [busy, onCancel, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/70" onClick={busy ? undefined : onCancel} aria-label="Close confirmation" />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative z-10 w-full max-w-md rounded-lg border border-[#31445f] bg-[#0d1728] p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} type="button" variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button type="button" variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={busy || confirmDisabled} aria-busy={busy}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? "Working..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function trapFocus(event: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const focusable = Array.from(container.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
