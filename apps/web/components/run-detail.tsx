"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, GitPullRequest, RefreshCcw, ShieldAlert, XCircle } from "lucide-react";
import { approveRun, getFindings, getReport, getRun, postGitHubComment, rejectRun } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Finding, GitHubCommentResponse, Report, RunDetail } from "@/types/api";
import { Badge, Button, Card, EmptyState, SeverityBadge } from "@/components/ui";
import { FindingsTable } from "@/components/findings-table";

export function RunDetailClient({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runData, findingData, reportData] = await Promise.all([getRun(runId), getFindings(runId), getReport(runId)]);
      setRun(runData);
      setFindings(findingData);
      setReport(reportData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run.");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (loading) {
    return <div className="rounded-lg border border-[#24324a] bg-[#0d1728] p-6 text-sm text-slate-400">Loading run...</div>;
  }
  if (error || !run || !report) {
    return <div className="rounded-lg border border-red-400/40 bg-red-500/12 p-6 text-sm text-red-100">{error ?? "Run not found."}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-[#24324a] pb-6 xl:flex-row xl:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <SeverityBadge severity={run.risk_level} />
            <Badge tone={run.approval_status === "approved" ? "success" : run.approval_status === "rejected" ? "danger" : "warn"}>{run.approval_status}</Badge>
            <Badge tone="neutral">{run.status.replaceAll("_", " ")}</Badge>
          </div>
          <h1 className="mt-4 text-3xl font-semibold text-white">{run.id}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{run.summary}</p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          <RefreshCcw className="h-4 w-4" /> Refresh
        </Button>
      </div>

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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
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

          <section>
            <h2 className="mb-4 text-lg font-semibold text-white">Findings</h2>
            <FindingsTable findings={findings} />
          </section>
        </div>

        <div className="space-y-6">
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

      <Card className="p-5">
        <h2 className="text-lg font-semibold text-white">PR comment draft</h2>
        {report.pr_comment_draft ? (
          <pre className="mt-4 max-h-[560px] overflow-auto rounded-md border border-[#25364d] bg-[#07101d] p-4 text-xs leading-6 text-slate-100">{report.pr_comment_draft}</pre>
        ) : (
          <EmptyState title="No draft generated" body="The report builder has not produced a PR comment for this run." />
        )}
      </Card>
    </div>
  );
}
