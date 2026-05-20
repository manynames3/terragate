"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, ClipboardCheck, CloudCog, DollarSign, FileText, GitPullRequest, History, LockKeyhole, Play, ShieldAlert, Siren } from "lucide-react";
import { createDemoTerraformReview, listRuns } from "@/lib/api";
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
    title: "Generate Runbook",
    status: "Available",
    description: "Generate backup, rollback, maintenance, signoff, and validation checklists from review evidence.",
    icon: FileText,
    href: "/runbooks"
  },
  {
    title: "Compliance Check",
    status: "Available",
    description: "CIS and NIST-style checklist mapped to findings, evidence, and approval state.",
    icon: ClipboardCheck,
    href: "/compliance"
  },
  {
    title: "Optimize Cloud Cost",
    status: "Coming soon",
    description: "Waste detection, rightsizing candidates, and accountability workflows.",
    icon: DollarSign
  }
];

const activationSteps = [
  {
    title: "Launch a sample review",
    description: "See the full risk workflow without uploading private Terraform data."
  },
  {
    title: "Attach GitHub context",
    description: "Map findings back to changed Terraform files and PR metadata."
  },
  {
    title: "Approve the draft",
    description: "Review the generated PR comment before any external write."
  },
  {
    title: "Use private deployment settings",
    description: "Enable Cognito, GitHub writes, Infracost, and policy packs for a real team."
  }
];

const trustControls = [
  {
    title: "Deterministic evidence first",
    description: "Rules parse the Terraform plan and produce JSON-path evidence before AI explains anything.",
    icon: CheckCircle2
  },
  {
    title: "Approval-gated GitHub writes",
    description: "Comments and fix commits are drafted first and blocked until a reviewer approves.",
    icon: GitPullRequest
  },
  {
    title: "Sensitive data guardrails",
    description: "Plan values and PR patch context are redacted before reviewer nodes use them.",
    icon: LockKeyhole
  },
  {
    title: "Auditable review history",
    description: "Runs preserve findings, approvals, check state, policy context, and action history.",
    icon: History
  }
];

export function Dashboard() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [launchingSample, setLaunchingSample] = useState<string | null>(null);

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
  const availableModes = modes.filter((mode) => mode.status === "Available");
  const plannedModes = modes.filter((mode) => mode.status !== "Available");

  async function launchDemo(sample: string) {
    setLaunchingSample(sample);
    setDemoError(null);
    try {
      const result = await createDemoTerraformReview(sample);
      router.push(`/runs/${result.run_id}`);
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : "Failed to launch demo review.");
    } finally {
      setLaunchingSample(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b border-[#24324a] pb-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">Terraform PR risk gate</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white md:text-4xl">Catch risky Terraform changes before merge</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            TerraGate reviews Terraform plans and GitHub PR context with deterministic evidence, AI-assisted remediation, runbook-grade checklists, and human approval before external actions.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="success">Deterministic checks first</Badge>
            <Badge tone="info">Approval-gated GitHub actions</Badge>
            <Badge tone="neutral">AWS + Terraform focused</Badge>
          </div>
        </div>
        <Link href="/reviews/new">
          <Button>
            New Terraform review <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <Card className="p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <h2 className="text-base font-semibold text-white">Fastest path to value</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              A reviewer should be able to understand the product in one run: launch a sample, inspect evidence, approve the draft, and see what would be posted to GitHub.
            </p>
          </div>
          <Link href="/reviews/new">
            <Button type="button" variant="secondary">
              Start walkthrough <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {activationSteps.map((step, index) => (
            <div key={step.title} className="rounded-md border border-[#26364d] bg-[#07101d] p-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[#43c6ac]/40 bg-[#43c6ac]/10 text-xs font-semibold text-[#9aeadc]">
                {index + 1}
              </div>
              <p className="mt-3 text-sm font-semibold text-white">{step.title}</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">{step.description}</p>
            </div>
          ))}
        </div>
      </Card>

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

      <Card className="p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-[#43c6ac]" />
              <h2 className="text-base font-semibold text-white">Hosted sample reviews</h2>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Launch a preloaded review without uploading sensitive Terraform data. Each sample runs the same graph, findings, remediation, approval, and audit workflow used by uploaded plans.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void launchDemo("risky-security")} disabled={launchingSample !== null}>
              {launchingSample === "risky-security" ? "Launching..." : "Try security risk"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void launchDemo("destructive-prod")} disabled={launchingSample !== null}>
              {launchingSample === "destructive-prod" ? "Launching..." : "Try prod blast radius"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void launchDemo("risky-cost")} disabled={launchingSample !== null}>
              {launchingSample === "risky-cost" ? "Launching..." : "Try cost spike"}
            </Button>
            {lastTerraformRun ? (
              <>
                <Link href={`/runbooks?run=${lastTerraformRun.id}`}>
                  <Button type="button" variant="ghost">Open runbook</Button>
                </Link>
                <Link href={`/compliance?run=${lastTerraformRun.id}`}>
                  <Button type="button" variant="ghost">Open compliance</Button>
                </Link>
              </>
            ) : null}
          </div>
        </div>
        {demoError ? <p className="mt-3 text-sm text-red-200">{demoError}</p> : null}
      </Card>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Trust controls</h2>
          <Badge tone="success">Built into the review flow</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {trustControls.map((control) => {
            const Icon = control.icon;
            return (
              <div key={control.title} className="rounded-lg border border-[#24324a] bg-[#0d1728]/88 p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-md border border-[#31445f] bg-[#111d31]">
                  <Icon className="h-4 w-4 text-[#43c6ac]" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-white">{control.title}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">{control.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Available command modes</h2>
          <Badge tone="info">3 live modes</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {availableModes.map((mode) => (
            <CommandModeCard key={mode.title} mode={mode} lastTerraformRun={lastTerraformRun} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Coming soon</h2>
          <Badge tone="neutral">Planned features</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plannedModes.map((mode) => (
            <CommandModeCard key={mode.title} mode={mode} lastTerraformRun={lastTerraformRun} />
          ))}
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
              <EmptyState title="No reviews yet" body="Launch a hosted sample or upload a Terraform plan to create the first review history entry." />
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

type CommandMode = (typeof modes)[number];

function CommandModeCard({ mode, lastTerraformRun }: { mode: CommandMode; lastTerraformRun: RunListItem | undefined }) {
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
  return available && "href" in mode && mode.href ? (
    <Link href={mode.href}>{content}</Link>
  ) : (
    <div>{content}</div>
  );
}
