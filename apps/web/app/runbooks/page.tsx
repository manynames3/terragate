import { Suspense } from "react";
import { RunbookCenter } from "@/components/runbook-center";

export default function RunbooksPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border border-[#24324a] bg-[#0d1728] p-6 text-sm text-slate-400">Loading runbook generator...</div>}>
      <RunbookCenter />
    </Suspense>
  );
}
