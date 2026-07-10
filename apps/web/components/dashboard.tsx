"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  Database,
  FileText,
  GitPullRequest,
  History,
  LockKeyhole,
  RefreshCcw,
  ShieldAlert,
  TerminalSquare
} from "lucide-react";
import { listRuns } from "@/lib/api";
import { cx, formatDate } from "@/lib/format";
import { presentRunListItem } from "@/lib/showcase";
import type { RunListItem } from "@/types/api";
import { AlertBanner, Badge, Button, Card, EmptyState, SeverityBadge } from "@/components/ui";

const modes = [
  {
    title: "Review Terraform PR",
    status: "Available",
    description: "Deterministic security, cost, reliability, and governance review for Terraform plan JSON.",
    icon: ShieldAlert,
    href: "/reviews/new"
  },
  {
    title: "Generate Runbook",
    status: "Available",
    description: "Backup, rollback, maintenance, signoff, and validation checklists from review evidence.",
    icon: FileText,
    href: "/runbooks"
  },
  {
    title: "Compliance Check",
    status: "Available",
    description: "CIS and NIST-style controls mapped to findings, evidence, and approval state.",
    icon: ClipboardCheck,
    href: "/compliance"
  }
];

const controlSignals = [
  {
    label: "Policy engine",
    value: "deterministic",
    detail: "JSON-path evidence before reviewer explanation",
    icon: CheckCircle2,
    tone: "success"
  },
  {
    label: "External writes",
    value: "approval gated",
    detail: "GitHub comments and fix commits require approval",
    icon: GitPullRequest,
    tone: "info"
  },
  {
    label: "Sensitive data",
    value: "redacted",
    detail: "Plan values and PR patches are sanitized first",
    icon: LockKeyhole,
    tone: "success"
  },
  {
    label: "Audit trail",
    value: "persisted",
    detail: "Runs preserve findings, approvals, checks, and actions",
    icon: History,
    tone: "neutral"
  }
];

const graphStages = ["ingest", "redact", "policy", "cost", "blast radius", "remediate", "approval", "github"];

export function Dashboard() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRuns((await listRuns()).map(presentRunListItem));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load the review queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const lastTerraformRun = runs.find((run) => run.mode === "terraform_pr_review");
  const stats = useMemo(() => {
    const total = runs.length;
    const pending = runs.filter((run) => run.approval_status === "pending").length;
    const approved = runs.filter((run) => run.approval_status === "approved").length;
    const high = runs.filter((run) => ["high", "critical"].includes(run.risk_level)).length;
    const latestScore = lastTerraformRun?.risk_score ?? 0;
    return { total, pending, approved, high, latestScore };
  }, [lastTerraformRun?.risk_score, runs]);
  const visibleRuns = runs.slice(0, 8);

  return (
    <div className="space-y-4">
      <OperationsHeader lastRun={lastTerraformRun} loading={loading} />

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#24324a] bg-[#24324a] xl:grid-cols-5">
        <MetricTile loading={loading} label="Reviews tracked" value={stats.total} detail={`${stats.approved} approved`} icon={<Database className="h-4 w-4" />} />
        <MetricTile loading={loading} label="Pending approval" value={stats.pending} detail="human gate" icon={<CheckCircle2 className="h-4 w-4" />} />
        <MetricTile loading={loading} label="High or critical" value={stats.high} detail="needs reviewer attention" icon={<ShieldAlert className="h-4 w-4" />} />
        <MetricTile loading={loading} label="Latest risk" value={`${stats.latestScore}/100`} detail={lastTerraformRun?.risk_level ?? "none"} icon={<Activity className="h-4 w-4" />} />
        <MetricTile label="Review graph" value="8 stages" detail="policy to approval" icon={<TerminalSquare className="h-4 w-4" />} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ReviewQueuePanel runs={visibleRuns} loading={loading} error={error} onRetry={loadRuns} />
        <CommandRail lastRun={lastTerraformRun} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <ControlSignalsPanel />
        <GraphStagePanel />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Command modes</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Available now</h2>
          </div>
          <Badge tone="info">3 live modes</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modes.map((mode) => (
            <CommandModeCard key={mode.title} mode={mode} lastTerraformRun={lastTerraformRun} />
          ))}
        </div>
      </section>
    </div>
  );
}

function OperationsHeader({ lastRun, loading }: { lastRun: RunListItem | undefined; loading: boolean }) {
  return (
    <Card className="p-5">
      <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">Terraform review operations</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white md:text-4xl">Risk gate command center</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            Review queue, approval status, policy coverage, and GitHub write readiness in one operating surface.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 xl:justify-end">
          <Link
            href="/reviews/new"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#43c6ac] px-4 py-2 text-sm font-semibold text-[#07111f] transition hover:bg-[#65d8c2]"
          >
            New Terraform review <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/reports" className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#31445f] bg-[#142238] px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-[#1b2b45]">Open reports</Link>
        </div>
      </div>
      <div className="mt-5 grid gap-3 border-t border-[#24324a] pt-5 md:grid-cols-4">
        <HeaderDatum loading={loading} label="latest run" value={lastRun?.id ?? "no runs"} href={lastRun ? `/runs/${lastRun.id}` : undefined} />
        <HeaderDatum loading={loading} label="environment" value={lastRun?.environment ?? "not set"} />
        <HeaderDatum loading={loading} label="approval" value={lastRun?.approval_status ?? "none"} />
        <HeaderDatum loading={loading} label="completed" value={lastRun?.completed_at ? formatDate(lastRun.completed_at) : "not completed"} />
      </div>
    </Card>
  );
}

function HeaderDatum({ label, value, href, loading }: { label: string; value: string; href?: string; loading?: boolean }) {
  if (loading) {
    return (
      <div className="border-l border-[#2b3d57] pl-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
        <div className="mt-3 h-4 w-32 animate-pulse rounded bg-[#17263d]" />
      </div>
    );
  }
  const content = <span className="block truncate text-sm font-semibold text-white">{value}</span>;
  return (
    <div className="border-l border-[#2b3d57] pl-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      {href ? (
        <Link href={href} className="mt-2 block hover:text-[#43c6ac]">
          {content}
        </Link>
      ) : (
        <span className="mt-2 block">{content}</span>
      )}
    </div>
  );
}

function MetricTile({ label, value, detail, icon, loading }: { label: string; value: string | number; detail: string; icon: React.ReactNode; loading?: boolean }) {
  return (
    <div className="min-h-28 bg-[#0b1525] p-4 last:col-span-2 xl:min-h-32 xl:p-5 xl:last:col-span-1">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</p>
      </div>
      {loading ? (
        <>
          <div className="mt-5 h-8 w-20 animate-pulse rounded bg-[#17263d]" />
          <div className="mt-3 h-3 w-28 animate-pulse rounded bg-[#132238]" />
        </>
      ) : (
        <>
          <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
          <p className="mt-1 text-sm capitalize text-slate-400">{detail}</p>
        </>
      )}
    </div>
  );
}

function ReviewQueuePanel({ runs, loading, error, onRetry }: { runs: RunListItem[]; loading: boolean; error: string | null; onRetry: () => Promise<void> }) {
  const router = useRouter();

  function openRun(runId: string) {
    router.push(`/runs/${runId}`);
  }

  return (
    <Card id="review-queue" className="scroll-mt-6 overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-[#24324a] p-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Review queue</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Recent Terraform risk reviews</h2>
        </div>
        <Link
          href="/approvals"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#31445f] bg-[#142238] px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-[#1b2b45]"
        >
          Approvals <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      {loading ? (
        <ReviewQueueSkeleton />
      ) : error ? (
        <div className="space-y-4 p-5">
          <AlertBanner tone="danger" title="Review queue unavailable">{error}</AlertBanner>
          <Button type="button" variant="secondary" onClick={() => void onRetry()}>Try again</Button>
        </div>
      ) : runs.length === 0 ? (
        <div className="p-5">
          <EmptyState title="No reviews yet" body="Upload a Terraform plan JSON file to create the first review history entry." />
        </div>
      ) : (
        <>
          <div className="divide-y divide-[#1d2a3f] md:hidden">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => openRun(run.id)}
                className="block w-full px-4 py-4 text-left transition hover:bg-[#1a2b42] focus-visible:bg-[#1a2b42]"
                aria-label={`Open Terraform review ${run.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs font-semibold text-white">{run.id}</p>
                    <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-400">{run.summary}</p>
                  </div>
                  <SeverityBadge severity={run.risk_level} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <Badge tone="neutral">{run.environment}</Badge>
                  <Badge tone={run.approval_status === "approved" ? "success" : run.approval_status === "rejected" ? "danger" : "warn"}>{run.approval_status}</Badge>
                  <span>{formatDate(run.completed_at)}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-left text-sm 2xl:min-w-[920px]">
            <thead className="border-b border-[#24324a] bg-[#101b2d] text-xs uppercase tracking-[0.12em] text-slate-400">
              <tr>
                <th className="px-4 py-3">Run</th>
                <th className="px-4 py-3">Env</th>
                <th className="px-4 py-3">Risk</th>
                <th className="px-4 py-3">Findings</th>
                <th className="px-4 py-3">Approval</th>
                <th className="hidden px-4 py-3 2xl:table-cell">Status</th>
                <th className="hidden px-4 py-3 2xl:table-cell">Completed</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, index) => (
                <tr
                  key={run.id}
                  role="link"
                  tabIndex={0}
                  aria-label={`Open Terraform review ${run.id}`}
                  title={`Open ${run.id}`}
                  onClick={() => openRun(run.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openRun(run.id);
                    }
                  }}
                  className={cx(
                    "group cursor-pointer border-b border-[#1d2a3f] outline-none transition last:border-0 hover:bg-[#1a2b42] focus-visible:bg-[#1a2b42] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#43c6ac]",
                    index === 0 ? "bg-[#123f3e]/50" : "bg-transparent"
                  )}
                >
                  <td className="px-4 py-4">
                    <Link
                      href={`/runs/${run.id}`}
                      onClick={(event) => event.stopPropagation()}
                      className="font-mono text-xs font-semibold text-white underline-offset-4 group-hover:text-[#43c6ac] group-hover:underline"
                    >
                      {run.id}
                    </Link>
                    <p className="mt-1 max-w-md truncate text-xs text-slate-400">{run.summary}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className="rounded-full border border-[#31445f] bg-[#101b2d] px-2 py-1 text-xs font-semibold uppercase text-slate-200">{run.environment}</span>
                  </td>
                  <td className="px-4 py-4"><SeverityBadge severity={run.risk_level} /></td>
                  <td className="px-4 py-4 text-slate-300">{formatSeverityCounts(run.severity_counts)}</td>
                  <td className="px-4 py-4">
                    <Badge tone={run.approval_status === "approved" ? "success" : run.approval_status === "rejected" ? "danger" : "warn"}>{run.approval_status}</Badge>
                  </td>
                  <td className="hidden px-4 py-4 text-slate-300 2xl:table-cell">{run.status.replaceAll("_", " ")}</td>
                  <td className="hidden px-4 py-4 text-slate-400 2xl:table-cell">{formatDate(run.completed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </Card>
  );
}

function ReviewQueueSkeleton() {
  return (
    <div className="p-5">
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="grid gap-3 rounded-md border border-[#1d2a3f] bg-[#091424] p-4 md:grid-cols-[minmax(220px,1fr)_80px_96px_1fr_104px]">
            <div>
              <div className="h-4 w-40 animate-pulse rounded bg-[#17263d]" />
              <div className="mt-3 h-3 w-full max-w-md animate-pulse rounded bg-[#132238]" />
            </div>
            <div className="h-7 w-16 animate-pulse rounded-full bg-[#132238]" />
            <div className="h-7 w-20 animate-pulse rounded-full bg-[#132238]" />
            <div className="h-4 w-full animate-pulse rounded bg-[#132238]" />
            <div className="h-7 w-24 animate-pulse rounded-full bg-[#132238]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandRail({ lastRun }: { lastRun: RunListItem | undefined }) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Review shortcuts</p>
        <div className="mt-4 grid gap-2">
          <RailLink href="/reviews/new" label="Upload plan JSON" icon={<Code2 className="h-4 w-4" />} />
          <RailLink href="/approvals" label="Approval center" icon={<CheckCircle2 className="h-4 w-4" />} />
          <RailLink href={lastRun ? `/runbooks?run=${lastRun.id}` : "/runbooks"} label="Runbook center" icon={<FileText className="h-4 w-4" />} />
          <RailLink href={lastRun ? `/compliance?run=${lastRun.id}` : "/compliance"} label="Compliance center" icon={<ClipboardCheck className="h-4 w-4" />} />
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Latest review</p>
        {lastRun ? (
          <div className="mt-4 space-y-3">
            <RuntimeLine label="Risk" value={`${lastRun.risk_level} (${lastRun.risk_score}/100)`} />
            <RuntimeLine label="Approval" value={lastRun.approval_status} />
            <RuntimeLine label="Status" value={lastRun.status.replaceAll("_", " ")} />
            <Link href={`/runs/${lastRun.id}`} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[#31445f] bg-[#101b2d] px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-[#1b2b45]">
              Open latest review <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-400">No persisted Terraform reviews are available yet.</p>
        )}
      </Card>
    </div>
  );
}

function RailLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="flex min-h-10 items-center gap-2 rounded-md border border-[#31445f] bg-[#101b2d] px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-[#1b2b45]">
      {icon}
      <span className="flex-1">{label}</span>
      <ArrowRight className="h-4 w-4 text-slate-500" />
    </Link>
  );
}

function RuntimeLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-right font-semibold text-slate-100">{value}</span>
    </div>
  );
}

function ControlSignalsPanel() {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Control signals</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Review safeguards</h2>
        </div>
        <Badge tone="success">active in graph</Badge>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {controlSignals.map((signal) => {
          const Icon = signal.icon;
          return (
            <div key={signal.label} className="rounded-md border border-[#26364d] bg-[#07101d] p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[#31445f] bg-[#111d31]">
                <Icon className="h-4 w-4 text-[#43c6ac]" />
              </span>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{signal.label}</p>
              <p className="mt-1 text-sm font-semibold text-white">{signal.value}</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">{signal.detail}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function GraphStagePanel() {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">LangGraph workflow</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Node-level review path</h2>
        </div>
        <RefreshCcw className="h-4 w-4 text-slate-500" />
      </div>
      <div className="mt-5 space-y-3">
        {graphStages.map((stage, index) => (
          <div key={stage} className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#43c6ac]/45 bg-[#43c6ac]/10 text-xs font-semibold text-[#9aeadc]">
              {index + 1}
            </span>
            <div className="h-px flex-1 bg-[#24324a]" />
            <span className="w-28 text-right text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">{stage}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

type CommandMode = (typeof modes)[number];

function CommandModeCard({ mode, lastTerraformRun }: { mode: CommandMode; lastTerraformRun: RunListItem | undefined }) {
  const Icon = mode.icon;
  const available = mode.status === "Available";
  const content = (
    <Card className={cx("min-h-44 p-5 transition", available ? "hover:border-[#3e587a]" : "opacity-80")}>
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-md border border-[#31445f] bg-[#111d31]">
          <Icon className={cx("h-5 w-5", available ? "text-[#6ea8fe]" : "text-slate-500")} />
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
          <p className="mt-2 line-clamp-2 text-sm text-slate-200">{lastTerraformRun.summary}</p>
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

function formatSeverityCounts(counts: Record<string, number>) {
  const critical = counts.critical ?? 0;
  const high = counts.high ?? 0;
  const medium = counts.medium ?? 0;
  const low = counts.low ?? 0;
  return `${critical}C / ${high}H / ${medium}M / ${low}L`;
}
