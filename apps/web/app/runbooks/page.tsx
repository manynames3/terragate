import { Suspense } from "react";
import { RunbookCenter } from "@/components/runbook-center";

export default function RunbooksPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-slate-600">Loading runbook generator...</div>}>
      <RunbookCenter />
    </Suspense>
  );
}
