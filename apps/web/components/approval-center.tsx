"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, GitPullRequest, XCircle } from "lucide-react";
import { approveRun, getCurrentUser, getReport, listRuns, postGitHubComment, rejectRun } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { canDecideReview, canPostReview } from "@/lib/review-actions";
import type { AuthUser, Report, RunListItem } from "@/types/api";
import { AlertBanner, Badge, Button, Card, ConfirmDialog, EmptyState, SeverityBadge } from "@/components/ui";

type Feedback = { tone: "success" | "danger"; text: string; href?: string };

export function ApprovalCenter() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"reject" | "post" | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  async function loadRuns() {
    setLoading(true);
    setError(null);
    try {
      const data = await listRuns();
      setRuns(data);
      setSelectedRunId((current) => current && data.some((run) => run.id === current) ? current : data.find((run) => run.approval_status === "pending")?.id ?? data[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load approval requests.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRuns();
    getCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setReport(null);
      return;
    }
    setReportLoading(true);
    setReport(null);
    setFeedback(null);
    let active = true;
    getReport(selectedRunId)
      .then((data) => { if (active) setReport(data); })
      .catch((loadError: Error) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setReportLoading(false); });
    return () => { active = false; };
  }, [selectedRunId]);

  const pendingRuns = useMemo(() => runs.filter((run) => run.approval_status === "pending"), [runs]);
  const selected = runs.find((run) => run.id === selectedRunId);
  const canReview = currentUser?.role === "reviewer" || currentUser?.role === "platform-admin";

  async function action(kind: "approve" | "reject" | "post") {
    if (!selected || !report || report.run_id !== selectedRunId) return;
    if (kind === "reject" && !notes.trim()) {
      setFeedback({ tone: "danger", text: "Add a rejection reason before requesting changes." });
      return;
    }
    setActionLoading(true);
    setFeedback(null);
    try {
      if (kind === "approve") {
        await approveRun(selected.id, notes, report.review_snapshot_hash);
        setFeedback({ tone: "success", text: "Draft approved and recorded in the audit trail." });
      }
      if (kind === "reject") {
        await rejectRun(selected.id, notes, report.review_snapshot_hash);
        setFeedback({ tone: "success", text: "Changes requested and the reason was recorded." });
      }
      if (kind === "post") {
        const result = await postGitHubComment(selectedRunId);
        setFeedback({ tone: "success", text: result.comment_url ? "Comment posted to GitHub." : result.message, href: result.comment_url ?? undefined });
      }
      await loadRuns();
      const refreshedReport = await getReport(selected.id);
      setReport((current) => current?.run_id === refreshedReport.run_id ? refreshedReport : current);
    } catch (actionError) {
      setFeedback({ tone: "danger", text: actionError instanceof Error ? actionError.message : "Action failed." });
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmAction() {
    const pending = confirmation;
    if (!pending) return;
    await action(pending);
    setConfirmation(null);
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--border)] pb-6">
        <p className="text-sm font-semibold uppercase tracking-normal text-[#0f766e]">Human in the loop</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">Approval center</h1>
        <p className="mt-2 text-sm text-slate-600">Review generated PR comments before anything can be posted externally.</p>
      </div>

      {error ? <AlertBanner tone="danger" title="Approval data unavailable" onDismiss={() => setError(null)}>{error}</AlertBanner> : null}

      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950">Review decisions</h2>
            <Badge tone="warn">{pendingRuns.length} pending</Badge>
          </div>
          {loading ? (
            <p className="text-sm text-slate-600">Loading approvals...</p>
          ) : runs.length === 0 ? (
            <EmptyState title="No runs yet" body="Approval requests appear after a Terraform review completes." />
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  aria-pressed={selectedRunId === run.id}
                  className={`w-full rounded-lg border p-4 text-left transition ${
                    selectedRunId === run.id ? "border-[#0f766e] bg-[#102237]" : "border-[var(--border)] bg-[var(--surface-muted)] hover:bg-[var(--surface-muted)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-slate-600">{run.id}</span>
                    <SeverityBadge severity={run.risk_level} />
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-slate-600">{run.summary}</p>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>{run.approval_status}</span>
                    <span>{formatDate(run.completed_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          {reportLoading ? (
            <div className="space-y-3" aria-busy="true">
              <div className="h-8 w-56 animate-pulse rounded bg-[var(--surface-muted)]" />
              <div className="h-[420px] animate-pulse rounded-md bg-[var(--surface-muted)]" />
            </div>
          ) : selected && report && report.run_id === selected.id ? (
            <div>
              <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-start">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">PR comment draft</h2>
                  <p className="mt-1 text-sm text-slate-600">{selected.id} / {selected.environment}</p>
                </div>
                <Link href={`/runs/${selected.id}`} className="inline-flex items-center gap-2 text-sm font-medium text-[#0f766e]">
                  Run detail <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
              <pre className="max-h-[560px] overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-xs leading-6 text-slate-900">{report.pr_comment_draft}</pre>
              {report.decision_blocker ? <p className="mt-3 text-sm text-amber-800">{report.decision_blocker}</p> : null}
              <label className="mt-4 block">
                <span className="text-sm font-medium text-slate-700">Decision notes</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add context for the change author and audit history"
                  className="mt-2 min-h-24 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-slate-950 placeholder:text-slate-500"
                />
              </label>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button onClick={() => void action("approve")} disabled={actionLoading || !canReview || !canDecideReview(selected, report) || report.approval_valid}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
                <Button variant="danger" onClick={() => setConfirmation("reject")} disabled={actionLoading || !canReview || !canDecideReview(selected, report) || selected.approval_status === "rejected"}>
                  <XCircle className="h-4 w-4" /> Reject
                </Button>
                <Button variant="secondary" disabled={actionLoading || !canReview || !canPostReview(selected, report)} onClick={() => setConfirmation("post")}>
                  <GitPullRequest className="h-4 w-4" /> Post to GitHub
                </Button>
              </div>
              {!canReview ? <p className="mt-3 text-xs leading-5 text-amber-800">Reviewer or platform administrator access is required to record decisions or post comments.</p> : null}
              {feedback ? <div className="mt-4"><AlertBanner tone={feedback.tone}>{feedback.text}{feedback.href ? <a href={feedback.href} target="_blank" rel="noreferrer" className="ml-1 font-semibold underline underline-offset-2">Open in GitHub</a> : null}</AlertBanner></div> : null}
            </div>
          ) : (
            <EmptyState title="Select a run" body="Choose a completed Terraform review to inspect the draft comment." />
          )}
        </Card>
      </div>
      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation === "reject" ? "Request changes on this review?" : "Post the approved comment to GitHub?"}
        description={confirmation === "reject" ? "The rejection reason will be persisted for the change author and future reviewers." : "This is an external write and cannot be recalled from TerraGate after GitHub accepts it."}
        confirmLabel={confirmation === "reject" ? "Request changes" : "Post comment"}
        tone={confirmation === "reject" ? "danger" : "primary"}
        busy={actionLoading}
        confirmDisabled={confirmation === "reject" && !notes.trim()}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirmAction()}
      >
        {confirmation === "reject" && !notes.trim() ? <AlertBanner tone="warning">Add a rejection reason in the notes field before continuing.</AlertBanner> : null}
      </ConfirmDialog>
    </div>
  );
}
