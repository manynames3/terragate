import { Suspense } from "react";
import { ComplianceCenter } from "@/components/compliance-center";

export default function CompliancePage() {
  return (
    <Suspense fallback={<div className="rounded-lg border border-[#24324a] bg-[#0d1728] p-6 text-sm text-slate-400">Loading compliance checks...</div>}>
      <ComplianceCenter />
    </Suspense>
  );
}
