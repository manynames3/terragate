import type { Severity } from "@/types/api";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function formatDate(value: string | null): string {
  if (!value) {
    return "Not completed";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function severityTone(severity: Severity | string): string {
  return (
    {
      critical: "border-red-400/50 bg-red-500/15 text-red-100",
      high: "border-orange-400/50 bg-orange-500/15 text-orange-100",
      medium: "border-amber-300/50 bg-amber-400/15 text-amber-100",
      low: "border-sky-300/50 bg-sky-400/15 text-sky-100",
      info: "border-slate-300/40 bg-slate-500/15 text-slate-100"
    }[severity] ?? "border-slate-300/40 bg-slate-500/15 text-slate-100"
  );
}
