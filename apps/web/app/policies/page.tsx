import { ShieldCheck } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { PolicyPackSettings } from "@/components/policy-pack-settings";

export default function PoliciesPage() {
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-normal text-[#0f766e]">Policy control plane</p>
            <h1 className="mt-3 text-3xl font-semibold text-slate-950">Policies</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Edit the deterministic guardrails that run before reviewer explanation: tags, regions, public ingress, production deletion rules, allowed resources, and cost thresholds.
            </p>
          </div>
          <span className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
            <ShieldCheck className="h-5 w-5 text-[#0f766e]" />
          </span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Badge tone="success">Deterministic</Badge>
          <Badge tone="info">Profile based</Badge>
          <Badge tone="neutral">API enforced</Badge>
        </div>
      </Card>
      <PolicyPackSettings />
    </div>
  );
}
