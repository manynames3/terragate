"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, ClipboardCheck, DollarSign, ExternalLink, FileDiff, FileSearch, GitPullRequest, History, LockKeyhole, RefreshCcw, ShieldAlert, XCircle } from "lucide-react";
import { approveFixPatch, approveRun, commitFixPatch, getAuditLog, getFindings, getFixPatches, getReport, getRun, postGitHubComment, rejectRun } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { AuditLogEntry, Finding, FixPatch, GitHubCommentResponse, Report, RunDetail } from "@/types/api";
import { Badge, Button, Card, EmptyState, SeverityBadge } from "@/components/ui";
import { FindingsTable } from "@/components/findings-table";

export function RunDetailClient({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [fixPatches, setFixPatches] = useState<FixPatch[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runData, findingData, reportData, patchData, auditData] = await Promise.all([
        getRun(runId),
        getFindings(runId),
        getReport(runId),
        getFixPatches(runId),
        getAuditLog(runId)
      ]);
      setRun(runData);
      setFindings(findingData);
      setReport(reportData);
      setFixPatches(patchData);
      setAuditLog(auditData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run.");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runStatus = run?.status;

  useEffect(() => {
    if (!runStatus || !["queued", "running"].includes(runStatus)) return;
    const interval = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(interval);
  }, [load, runStatus]);

  const categoryCounts = useMemo(() => {
    return findings.reduce<Record<string, number>>((acc, finding) => {
      acc[finding.category] = (acc[finding.category] ?? 0) + 1;
      return acc;
    }, {});
  }, [findings]);

  async function runAction(action: "approve" | "reject" | "post") {
    setActionLoading(true);
    setMessage(null);
    try {
      if (action === "approve") {
        await approveRun(runId, notes);
        setMessage("PR comment draft approved.");
      }
      if (action === "reject") {
        await rejectRun(runId, notes);
        setMessage("PR comment draft rejected.");
      }
      if (action === "post") {
        const result: GitHubCommentResponse = await postGitHubComment(runId);
        setMessage(result.comment_url ? `Posted to GitHub: ${result.comment_url}` : result.message);
      }
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActionLoading(false);
    }
  }

  async function approvePatch(patchId: string) {
    setActionLoading(true);
    setMessage(null);
    try {
      await approveFixPatch(runId, patchId);
      setMessage("Suggested patch approved for implementation.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Patch approval failed.");
    } finally {
      setActionLoading(false);
    }
  }

  async function commitPatch(patchId: string) {
    setActionLoading(true);
    setMessage(null);
    try {
      const result = await commitFixPatch(runId, patchId);
      setMessage(result.commit_url ? `Committed patch to PR branch: ${result.commit_url}` : result.message);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Patch commit failed.");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return <div className="rounded-lg border border-[#24324a] bg-[#0d1728] p-6 text-sm text-slate-400">Loading run...</div>;
  }
  if (error || !run || !report) {
    return <div className="rounded-lg border border-red-400/40 bg-red-500/12 p-6 text-sm text-red-100">{error ?? "Run not found."}</div>;
  }

  const decisionBrief = buildDecisionBrief(run, findings);
  const topFindings = findings.slice().sort(compareFindingsBySeverity).slice(0, 3);

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-[#24324a] pb-6 xl:flex-row xl:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <SeverityBadge severity={run.risk_level} />
            <Badge tone={run.approval_status === "approved" ? "success" : run.approval_status === "rejected" ? "danger" : "warn"}>{run.approval_status}</Badge>
            <Badge tone="neutral">{run.status.replaceAll("_", " ")}</Badge>
          </div>
          <h1 className="mt-4 text-3xl font-semibold text-white">Review decision: {decisionBrief.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{run.summary}</p>
          <p className="mt-2 font-mono text-xs text-slate-500">{run.id}</p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          <RefreshCcw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <DecisionBrief run={run} report={report} decision={decisionBrief} topFindings={topFindings} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <p className="text-sm text-slate-400">Risk score</p>
          <p className="mt-2 text-4xl font-semibold text-white">{run.risk_score}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.12em] text-slate-500">{run.risk_level}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-400">Findings</p>
          <p className="mt-2 text-4xl font-semibold text-white">{findings.length}</p>
          <p className="mt-2 text-xs text-slate-500">{run.severity_counts.high ?? 0} high, {run.severity_counts.medium ?? 0} medium</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-400">Environment</p>
          <p className="mt-2 text-4xl font-semibold text-white capitalize">{run.environment}</p>
          <p className="mt-2 text-xs text-slate-500">{run.cloud_provider.toUpperCase()} / {run.policy_profile}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-400">Completed</p>
          <p className="mt-2 text-xl font-semibold text-white">{formatDate(run.completed_at)}</p>
          <p className="mt-2 text-xs text-slate-500">{run.trace_id ? `Trace ${run.trace_id}` : "LangSmith disabled"}</p>
        </Card>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-[#43c6ac]" />
              <h2 className="text-lg font-semibold text-white">Severity breakdown</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-5">
              {(["critical", "high", "medium", "low", "info"] as const).map((severity) => (
                <div key={severity} className="rounded-md border border-[#26364d] bg-[#091424] p-4">
                  <SeverityBadge severity={severity} />
                  <p className="mt-3 text-2xl font-semibold text-white">{run.severity_counts[severity] ?? 0}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-semibold text-white">Plan summary</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-5">
              {[
                ["Changed", run.plan_summary.total_resource_changes ?? 0],
                ["Creates", run.plan_summary.creates ?? 0],
                ["Updates", run.plan_summary.updates ?? 0],
                ["Deletes", run.plan_summary.deletes ?? 0],
                ["Replaces", run.plan_summary.replacements ?? 0]
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-[#26364d] bg-[#091424] p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-[#43c6ac]" />
                <h2 className="text-lg font-semibold text-white">Cost delta</h2>
              </div>
              <p className="text-3xl font-semibold text-white">
                ${Number(run.cost_estimate.monthly_delta ?? 0).toFixed(2)}
                <span className="ml-2 text-sm font-normal text-slate-400">/ mo</span>
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <SmallMetric label="Annual" value={`$${Number(run.cost_estimate.annual_delta ?? Number(run.cost_estimate.monthly_delta ?? 0) * 12).toFixed(2)}`} />
                <SmallMetric label="Threshold" value={`$${Number(run.cost_estimate.threshold ?? 0).toFixed(2)}/mo`} />
                <SmallMetric label="Source" value={run.cost_estimate.source ?? "heuristic"} />
              </div>
              <p className="mt-3 text-sm text-slate-400">{run.cost_estimate.message ?? "No cost estimate generated yet."}</p>
              {run.cost_estimate.over_threshold ? <p className="mt-2 text-sm font-medium text-amber-100">This cost delta exceeds the selected policy threshold and needs approval.</p> : null}
              <div className="mt-4 space-y-2">
                {(run.cost_estimate.line_items ?? []).slice(0, 4).map((item) => (
                  <div key={`${item.resource_address}-${item.description}`} className="flex items-center justify-between gap-3 rounded-md border border-[#26364d] bg-[#091424] px-3 py-2 text-xs">
                    <span className="truncate font-mono text-slate-200">{item.resource_address ?? item.description}</span>
                    <span className="shrink-0 text-slate-300">${Number(item.monthly_delta ?? 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-5 w-5 text-[#6ea8fe]" />
                <h2 className="text-lg font-semibold text-white">Blast radius</h2>
              </div>
              <div className="flex items-center gap-3">
                <SeverityBadge severity={run.blast_radius.level ?? "low"} />
                <span className="text-3xl font-semibold text-white">{run.blast_radius.score ?? 0}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">{run.blast_radius.summary ?? "No destructive stateful changes detected."}</p>
              {(run.blast_radius.stateful_changes ?? []).slice(0, 3).map((item) => (
                <div key={`${item.resource_address}-${item.resource_type}`} className="mt-3 rounded-md border border-[#26364d] bg-[#091424] p-3">
                  <p className="font-mono text-xs text-slate-200">{item.resource_address}</p>
                  <p className="mt-1 text-xs text-slate-500">{(item.factors ?? []).join(" / ")}</p>
                  <p className="mt-2 text-xs text-slate-300">{item.replacement_risk ?? "replacement risk not classified"} / {item.backup_status ?? "backup unknown"}</p>
                  {(item.required_runbook ?? []).length ? (
                    <ul className="mt-2 space-y-1 text-xs text-slate-400">
                      {(item.required_runbook ?? []).slice(0, 3).map((step) => (
                        <li key={step}>- {step}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </Card>
          </div>

          <section>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white">Evidence-backed findings</h2>
              <p className="mt-1 text-sm text-slate-400">Each row links the reviewer claim to Terraform evidence, changed files, impact, and a concrete fix path.</p>
            </div>
            <FindingsTable findings={findings} />
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          <GitHubPreviewCard run={run} report={report} actionLoading={actionLoading} onApprove={() => void runAction("approve")} onPost={() => void runAction("post")} />

          {run.github_pr_context || run.repo_owner ? (
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <GitPullRequest className="h-5 w-5 text-[#6ea8fe]" />
                <h2 className="text-lg font-semibold text-white">GitHub PR context</h2>
              </div>
              <GitHubContextCard run={run} />
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="text-lg font-semibold text-white">Graph progress</h2>
            <div className="mt-5 space-y-3">
              {run.graph_progress.map((step) => (
                <div key={`${step.node}-${step.timestamp}`} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-[#43c6ac]" />
                  <div>
                    <p className="text-sm font-medium text-slate-100">{step.node}</p>
                    <p className="text-xs text-slate-500">{step.status} / {formatDate(step.timestamp)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-semibold text-white">Execution status</h2>
            <div className="mt-4 grid gap-3">
              <SmallMetric label="Job" value={run.job ? `${run.job.status} / attempt ${run.job.attempts}` : "not queued"} />
              <SmallMetric label="Plan source" value={run.terraform_execution.mode ?? "uploaded_plan"} />
              <SmallMetric label="GitHub check" value={run.github_check ? `${run.github_check.state} / ${run.github_check.status}` : "not created"} />
              {run.github_check?.check_url ? (
                <a href={run.github_check.check_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[#43c6ac]">
                  Open check run <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          </Card>

          <DataHandlingCard run={run} />

          <Card className="p-5">
            <h2 className="text-lg font-semibold text-white">Category mix</h2>
            <div className="mt-4 space-y-3">
              {["security", "cost", "reliability", "governance", "compliance"].map((category) => (
                <div key={category} className="flex items-center justify-between rounded-md border border-[#26364d] bg-[#091424] px-3 py-2">
                  <span className="capitalize text-slate-300">{category}</span>
                  <span className="font-semibold text-white">{categoryCounts[category] ?? 0}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-semibold text-white">Approval center</h2>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Approval or rejection notes"
              className="mt-4 min-h-24 w-full resize-y rounded-md border border-[#31445f] bg-[#09111f] p-3 text-sm text-white placeholder:text-slate-500"
            />
            <div className="mt-4 grid gap-2">
              <Button onClick={() => void runAction("approve")} disabled={actionLoading} className="w-full">
                <CheckCircle2 className="h-4 w-4" /> Approve GitHub comment
              </Button>
              <Button variant="danger" onClick={() => void runAction("reject")} disabled={actionLoading} className="w-full">
                <XCircle className="h-4 w-4" /> Reject draft
              </Button>
              <Button variant="secondary" onClick={() => void runAction("post")} disabled={actionLoading || run.approval_status !== "approved"} className="w-full">
                <GitPullRequest className="h-4 w-4" /> Post to GitHub
              </Button>
            </div>
            {message ? <p className="mt-4 rounded-md border border-[#31445f] bg-[#091424] p-3 text-sm text-slate-200">{message}</p> : null}
          </Card>
        </div>
      </div>

      <Card className="min-w-0 p-5">
        <h2 className="text-lg font-semibold text-white">PR comment draft</h2>
        {report.pr_comment_draft ? (
          <pre className="mt-4 max-h-[560px] min-w-0 overflow-auto rounded-md border border-[#25364d] bg-[#07101d] p-4 text-xs leading-6 text-slate-100">{report.pr_comment_draft}</pre>
        ) : (
          <EmptyState title="No draft generated" body="The report builder has not produced a PR comment for this run." />
        )}
      </Card>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <Card className="min-w-0 p-5">
          <div className="mb-4 flex items-center gap-2">
            <FileDiff className="h-5 w-5 text-[#43c6ac]" />
            <h2 className="text-lg font-semibold text-white">Suggested fix workflow</h2>
          </div>
          {fixPatches.length ? (
            <div className="space-y-4">
              {fixPatches.slice(0, 4).map((patch) => (
                <div key={patch.id} className="min-w-0 rounded-md border border-[#26364d] bg-[#091424] p-4">
                  <div className="flex min-w-0 flex-col justify-between gap-3 md:flex-row md:items-start">
                    <div className="min-w-0">
                      <Badge tone={patch.status === "approved" || patch.status === "committed" ? "success" : "neutral"}>{patch.status}</Badge>
                      <p className="mt-2 break-words text-sm font-semibold text-white">{patch.summary}</p>
                      <p className="mt-1 truncate font-mono text-xs text-slate-500">{patch.pr_file_path}</p>
                      {patch.commit_url ? (
                        <a href={patch.commit_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#43c6ac]">
                          Open commit <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                      <Button variant="secondary" disabled={actionLoading || patch.status === "approved" || patch.status === "committed"} onClick={() => void approvePatch(patch.id)}>
                        <CheckCircle2 className="h-4 w-4" /> Approve patch
                      </Button>
                      <Button disabled={actionLoading || patch.status !== "approved"} onClick={() => void commitPatch(patch.id)}>
                        <GitPullRequest className="h-4 w-4" /> Commit to PR
                      </Button>
                    </div>
                  </div>
                  <pre className="mt-3 max-h-52 min-w-0 overflow-auto rounded-md border border-[#25364d] bg-[#07101d] p-3 text-xs leading-5 text-slate-200">{patch.diff}</pre>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No suggested patches" body="Remediation snippets will appear here as PR-ready patch drafts when findings include enough context." />
          )}
        </Card>

        <Card className="min-w-0 p-5">
          <div className="mb-4 flex items-center gap-2">
            <History className="h-5 w-5 text-[#6ea8fe]" />
            <h2 className="text-lg font-semibold text-white">Audit log</h2>
          </div>
          {auditLog.length ? (
            <div className="space-y-3">
              {auditLog.slice(0, 10).map((entry) => (
                <div key={entry.id} className="rounded-md border border-[#26364d] bg-[#091424] p-3">
                  <p className="text-sm font-medium text-slate-100">{entry.action}</p>
                  <p className="mt-1 text-xs text-slate-500">{entry.actor_email ?? "system"} / {formatDate(entry.created_at)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No audit events" body="Worker, approval, GitHub, and patch events will be recorded here." />
          )}
        </Card>
      </div>
    </div>
  );
}

type DecisionBriefData = {
  title: string;
  summary: string;
  nextAction: string;
  tone: "success" | "warn" | "danger";
};

const severityRank: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

function buildDecisionBrief(run: RunDetail, findings: Finding[]): DecisionBriefData {
  const critical = run.severity_counts.critical ?? 0;
  const high = run.severity_counts.high ?? 0;
  const criticalRisk = run.risk_level === "critical";
  const replacements = run.plan_summary.replacements ?? 0;
  const costOverThreshold = Boolean(run.cost_estimate.over_threshold);
  const productionStatefulChange = run.environment === "prod" && replacements > 0 && (run.blast_radius.level === "high" || run.blast_radius.level === "critical");
  const topFinding = findings.slice().sort(compareFindingsBySeverity)[0];

  if (critical > 0 || criticalRisk) {
    return {
      title: "Block merge",
      summary: `Critical infrastructure risk is present${topFinding ? `: ${topFinding.title}` : "."}`,
      nextAction: "Fix critical findings, rerun the review, then approve the GitHub draft.",
      tone: "danger"
    };
  }

  if (productionStatefulChange) {
    return {
      title: "Require production approval",
      summary: "The plan touches stateful production resources and needs rollback and backup validation before merge.",
      nextAction: "Confirm the runbook, maintenance window, and rollback plan before approving.",
      tone: "warn"
    };
  }

  if (high > 0 || costOverThreshold) {
    return {
      title: "Review before merge",
      summary: high > 0 ? "High-severity findings need owner review before this PR is safe to merge." : "The estimated monthly cost exceeds the active policy threshold.",
      nextAction: "Assign the finding owner, resolve or accept the risk, then approve the draft.",
      tone: "warn"
    };
  }

  return {
    title: "Ready with notes",
    summary: "No blocking risk was detected by the configured policy profile.",
    nextAction: "Review the generated note and post it to GitHub when ready.",
    tone: "success"
  };
}

function compareFindingsBySeverity(a: Finding, b: Finding) {
  return (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0);
}

function DecisionBrief({ run, report, decision, topFindings }: { run: RunDetail; report: Report; decision: DecisionBriefData; topFindings: Finding[] }) {
  const changes = run.plan_summary;
  const monthlyDelta = Number(run.cost_estimate.monthly_delta ?? 0);
  return (
    <Card className="p-5">
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={decision.tone}>{decision.title}</Badge>
            <Badge tone={run.github_check?.state === "fail" ? "danger" : run.github_check?.state === "warn" ? "warn" : "neutral"}>
              GitHub check: {run.github_check?.state ?? "not created"}
            </Badge>
          </div>
          <h2 className="mt-4 text-xl font-semibold text-white">What this means for the reviewer</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">{decision.summary}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{report.risk_score.summary}</p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <DecisionMetric icon={FileSearch} label="Changed resources" value={String(changes.total_resource_changes ?? 0)} detail={`${changes.creates ?? 0} create / ${changes.updates ?? 0} update / ${changes.deletes ?? 0} delete`} />
            <DecisionMetric icon={AlertTriangle} label="Blast radius" value={`${run.blast_radius.score ?? 0}`} detail={run.blast_radius.summary ?? "No destructive stateful changes detected."} />
            <DecisionMetric icon={DollarSign} label="Cost delta" value={`$${monthlyDelta.toFixed(2)}/mo`} detail={run.cost_estimate.message ?? "Heuristic estimate"} />
          </div>
        </div>
        <div className="rounded-md border border-[#26364d] bg-[#091424] p-4">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-[#43c6ac]" />
            <h3 className="text-sm font-semibold text-white">Next action</h3>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">{decision.nextAction}</p>
          <div className="mt-4 space-y-2">
            {topFindings.length ? (
              topFindings.map((finding) => (
                <div key={finding.id} className="rounded-md border border-[#26364d] bg-[#07101d] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-100">{finding.title}</p>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{finding.impact || finding.description}</p>
                </div>
              ))
            ) : (
              <p className="rounded-md border border-[#26364d] bg-[#07101d] p-3 text-sm text-slate-400">No findings were produced for this run.</p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function DecisionMetric({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-[#26364d] bg-[#091424] p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        <Icon className="h-3.5 w-3.5 text-[#6ea8fe]" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">{detail}</p>
    </div>
  );
}

function GitHubPreviewCard({ run, report, actionLoading, onApprove, onPost }: { run: RunDetail; report: Report; actionLoading: boolean; onApprove: () => void; onPost: () => void }) {
  const draft = report.pr_comment_draft?.trim();
  const preview = draft ? draft.split("\n").filter(Boolean).slice(0, 8).join("\n") : "";
  const approved = run.approval_status === "approved";
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-5 w-5 text-[#6ea8fe]" />
          <h2 className="text-lg font-semibold text-white">GitHub preview</h2>
        </div>
        <Badge tone={approved ? "success" : "warn"}>{approved ? "Approved" : "Needs approval"}</Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        This is the exact reviewer-facing moment: inspect the draft, approve it, then post to GitHub. Anonymous hosted-demo writes stay mocked.
      </p>
      {preview ? (
        <pre className="mt-4 max-h-72 overflow-auto rounded-md border border-[#25364d] bg-[#07101d] p-3 text-xs leading-5 text-slate-100">{preview}</pre>
      ) : (
        <div className="mt-4">
          <EmptyState title="No draft generated" body="The report builder has not produced a GitHub comment for this run." />
        </div>
      )}
      <div className="mt-4 grid gap-2">
        <Button onClick={onApprove} disabled={actionLoading || approved || !draft} className="w-full">
          <CheckCircle2 className="h-4 w-4" /> Approve draft
        </Button>
        <Button variant="secondary" onClick={onPost} disabled={actionLoading || !approved || !draft} className="w-full">
          <GitPullRequest className="h-4 w-4" /> Post to GitHub
        </Button>
      </div>
    </Card>
  );
}

function GitHubContextCard({ run }: { run: RunDetail }) {
  const context = run.github_pr_context;
  if (!context) {
    return (
      <div className="mt-4 rounded-md border border-[#26364d] bg-[#091424] p-4 text-sm text-slate-300">
        {run.repo_owner}/{run.repo_name}#{run.pull_number}
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-white">
          {context.title ?? `${context.repo_full_name ?? "GitHub PR"}#${context.pull_number ?? ""}`}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-400">{context.message}</p>
        {context.html_url ? (
          <a href={context.html_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#43c6ac]">
            Open pull request <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <SmallMetric label="Source" value={context.mock ? "dev placeholder" : "live GitHub"} />
        <SmallMetric label="Files" value={String(context.changed_files_count)} />
        <SmallMetric label="Terraform" value={String(context.terraform_files.length)} />
        <SmallMetric label="Diff" value={`+${context.additions} / -${context.deletions}`} />
      </div>
      {context.base_ref || context.head_ref ? (
        <div className="rounded-md border border-[#26364d] bg-[#091424] p-3 font-mono text-xs text-slate-300">
          {context.base_ref ?? "base"} {"<-"} {context.head_ref ?? "head"}
        </div>
      ) : null}
      {context.terraform_files.length > 0 ? (
        <div className="space-y-2">
          {context.terraform_files.slice(0, 5).map((file) => (
            <div key={file.filename} className="rounded-md border border-[#26364d] bg-[#091424] p-3">
              <p className="truncate font-mono text-xs text-slate-200">{file.filename}</p>
              <p className="mt-1 text-xs text-slate-500">{file.status} / +{file.additions} / -{file.deletions}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#26364d] bg-[#091424] p-3">
      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-white">{value}</p>
    </div>
  );
}

function DataHandlingCard({ run }: { run: RunDetail }) {
  const artifacts = run.artifacts ?? [];
  const rawArtifacts = artifacts.filter((artifact) => !artifact.redacted);
  const redactedArtifacts = artifacts.filter((artifact) => artifact.redacted);
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <LockKeyhole className="h-5 w-5 text-[#43c6ac]" />
        <h2 className="text-lg font-semibold text-white">Data handling</h2>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        Raw Terraform artifacts are stored for audit history. AI-assisted review receives redacted, reduced evidence; GitHub writes stay blocked until approval.
      </p>
      <div className="mt-4 grid gap-3">
        <SmallMetric label="Raw artifacts" value={String(rawArtifacts.length)} />
        <SmallMetric label="Redacted artifacts" value={String(redactedArtifacts.length)} />
        <SmallMetric label="GitHub patch context" value={run.github_pr_context ? "redacted + truncated" : "not attached"} />
        <SmallMetric label="Policy version" value={run.policy_profile} />
      </div>
      {artifacts.length ? (
        <div className="mt-4 space-y-2">
          {artifacts.slice(0, 5).map((artifact) => (
            <div key={artifact.id} className="rounded-md border border-[#26364d] bg-[#091424] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-200">{artifact.type}</span>
                <Badge tone={artifact.redacted ? "success" : "warn"}>{artifact.redacted ? "redacted" : "raw"}</Badge>
              </div>
              <p className="mt-1 truncate font-mono text-xs text-slate-500">sha256:{artifact.sha256}</p>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
