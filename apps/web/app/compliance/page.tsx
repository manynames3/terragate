import { Suspense } from "react";
import { ComplianceCenter } from "@/components/compliance-center";

export default function CompliancePage() {
  return (
    <Suspense fallback={<div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-slate-600">Loading compliance checks...</div>}>
      <ComplianceCenter />
    </Suspense>
  );
}
