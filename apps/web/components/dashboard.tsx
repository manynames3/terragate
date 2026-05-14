"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ClipboardCheck, CloudCog, DollarSign, FileText, ShieldAlert, Siren } from "lucide-react";
import { listRuns } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { RunListItem } from "@/types/api";
import { Badge, Button, Card, EmptyState, SeverityBadge } from "@/components/ui";

const modes = [
  {
    title: "Review Terraform PR",
    status: "Available",
    description: "Upload a Terraform plan and run deterministic security, cost, reliability, and governance review.",
    icon: ShieldAlert,
    href: "/reviews/new"
  },
  {
    title: "Investigate Incident",
    status: "Coming soon",
    description: "Logs, metrics, and runbook reasoning for incident triage.",
    icon: Siren
  },
  {
    title: "Optimize Cloud Cost",
    status: "Coming soon",
    description: "Waste detection, rightsizing candidates, and accountability workflows.",
    icon: DollarSign
  },
  {
    title: "Generate Runbook",
    status: "Coming soon",
    description: "Convert cloud architecture and service metadata into operational documentation.",
    icon: FileText
  },
  {
    title: "Compliance Check",
    status: "Coming soon",
    description: "CIS and NIST-style checklists mapped to deployable evidence.",
    icon: ClipboardCheck
  }
];

export function Dashboard() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRuns()
      .then(setRuns)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const lastTerraformRun = runs.find((run) => run.mode === "terraform_pr_review");
  const stats = useMemo(() => {
    const total = runs.length;
    const pending = runs.filter((run) => run.approval_status === "pending").length;
    const high = runs.filter((run) => ["high", "critical"].includes(run.risk_level)).length;
    return { total, pending, high };
  }, [runs]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b border-[#24324a] pb-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">Portfolio platform v1</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white md:text-4xl">Terraform PR risk gate</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            A production-style workflow for reviewing infrastructure changes with deterministic evidence, AI-assisted remediation, and human approval before external actions.
          </p>
        </div>
        <Link href="/reviews/new">
          <Button>
            New Terraform review <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-slate-400">Total runs</p>
          <p className="mt-2 text-3xl font-semibold text-white">{stats.total}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-400">Pending approvals</p>
          <p className="mt-2 text-3xl font-semibold text-white">{stats.pending}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-400">High or critical risk</p>
          <p className="mt-2 text-3xl font-semibold text-white">{stats.high}</p>
        </Card>
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Command modes</h2>
          <Badge tone="info">Terraform reviewer live</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modes.map((mode) => {
            const Icon = mode.icon;
            const available = mode.status === "Available";
            const content = (
              <Card className="min-h-48 p-5 transition hover:border-[#3e587a]">
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-md border border-[#31445f] bg-[#111d31]">
                    <Icon className="h-5 w-5 text-[#6ea8fe]" />
                  </span>
                  <Badge tone={available ? "success" : "neutral"}>{mode.status}</Badge>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-white">{mode.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{mode.description}</p>
                {mode.title === "Review Terraform PR" && lastTerraformRun ? (
                  <div className="mt-5 rounded-md border border-[#26364d] bg-[#091424] p-3">
                    <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                      <span>Last run</span>
                      <SeverityBadge severity={lastTerraformRun.risk_level} />
                    </div>
                    <p className="mt-2 text-sm text-slate-200">{lastTerraformRun.summary}</p>
                  </div>
                ) : null}
              </Card>
            );
            return available && mode.href ? (
              <Link href={mode.href} key={mode.title}>{content}</Link>
            ) : (
              <div key={mode.title}>{content}</div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <CloudCog className="h-5 w-5 text-[#43c6ac]" />
          <h2 className="text-xl font-semibold text-white">Recent runs</h2>
        </div>
        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-6 text-sm text-slate-400">Loading run history...</div>
          ) : error ? (
            <div className="p-6 text-sm text-red-200">{error}</div>
          ) : runs.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No runs yet" body="Upload one of the sample Terraform plans to populate the command center." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-[#24324a] bg-[#101b2d] text-xs uppercase tracking-[0.12em] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Run</th>
                    <th className="px-4 py-3">Environment</th>
                    <th className="px-4 py-3">Risk</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-[#1d2a3f] last:border-0">
                      <td className="px-4 py-4">
                        <Link href={`/runs/${run.id}`} className="font-medium text-white hover:text-[#43c6ac]">{run.id}</Link>
                        <p className="mt-1 max-w-xl truncate text-xs text-slate-400">{run.summary}</p>
                      </td>
                      <td className="px-4 py-4 capitalize text-slate-300">{run.environment}</td>
                      <td className="px-4 py-4"><SeverityBadge severity={run.risk_level} /></td>
                      <td className="px-4 py-4 text-slate-300">{run.status.replaceAll("_", " ")}</td>
                      <td className="px-4 py-4 text-slate-400">{formatDate(run.completed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
