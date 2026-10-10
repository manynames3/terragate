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
      critical: "border-red-200 bg-red-50 text-red-800",
      high: "border-orange-200 bg-orange-50 text-orange-800",
      medium: "border-amber-200 bg-amber-50 text-amber-800",
      low: "border-sky-200 bg-sky-50 text-sky-800",
      info: "border-slate-200 bg-slate-50 text-slate-700"
    }[severity] ?? "border-slate-200 bg-slate-50 text-slate-700"
  );
}

export function formatRisk(score: number | null, level: string): string {
  if (score === null) return level === "unavailable" ? "Unavailable" : "Not assessed";
  return `${level} (${score}/100)`;
}
