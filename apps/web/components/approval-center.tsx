"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, GitPullRequest, XCircle } from "lucide-react";
import { approveRun, getReport, listRuns, postGitHubComment, rejectRun } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Report, RunListItem } from "@/types/api";
import { Badge, Button, Card, EmptyState, SeverityBadge } from "@/components/ui";

export function ApprovalCenter() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadRuns() {
    setLoading(true);
    const data = await listRuns();
    setRuns(data);
    setSelectedRunId((current) => current ?? data.find((run) => run.approval_status === "pending")?.id ?? data[0]?.id ?? null);
    setLoading(false);
  }

  useEffect(() => {
    void loadRuns();
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setReport(null);
      return;
    }
    getReport(selectedRunId).then(setReport).catch((err: Error) => setMessage(err.message));
  }, [selectedRunId]);

  const pendingRuns = useMemo(() => runs.filter((run) => run.approval_status === "pending"), [runs]);
  const selected = runs.find((run) => run.id === selectedRunId);

  async function action(kind: "approve" | "reject" | "post") {
    if (!selectedRunId) return;
    try {
      if (kind === "approve") {
        await approveRun(selectedRunId, notes);
        setMessage("Draft approved.");
      }
      if (kind === "reject") {
        await rejectRun(selectedRunId, notes);
        setMessage("Draft rejected.");
      }
      if (kind === "post") {
        const result = await postGitHubComment(selectedRunId);
        setMessage(result.comment_url ? `Posted comment: ${result.comment_url}` : result.message);
      }
      await loadRuns();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action failed.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-[#24324a] pb-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">Human in the loop</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">Approval center</h1>
        <p className="mt-2 text-sm text-slate-400">Review generated PR comments before anything can be posted externally.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Pending runs</h2>
            <Badge tone="warn">{pendingRuns.length} pending</Badge>
          </div>
          {loading ? (
            <p className="text-sm text-slate-400">Loading approvals...</p>
          ) : runs.length === 0 ? (
            <EmptyState title="No runs yet" body="Approval requests appear after a Terraform review completes." />
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={`w-full rounded-lg border p-4 text-left transition ${
                    selectedRunId === run.id ? "border-[#43c6ac] bg-[#102237]" : "border-[#26364d] bg-[#091424] hover:bg-[#101b2d]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-slate-300">{run.id}</span>
                    <SeverityBadge severity={run.risk_level} />
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-slate-300">{run.summary}</p>
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
          {selected && report ? (
            <div>
              <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-start">
                <div>
                  <h2 className="text-xl font-semibold text-white">PR comment draft</h2>
                  <p className="mt-1 text-sm text-slate-400">{selected.id} / {selected.environment}</p>
                </div>
                <Link href={`/runs/${selected.id}`} className="inline-flex items-center gap-2 text-sm font-medium text-[#43c6ac]">
                  Run detail <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
              <pre className="max-h-[560px] overflow-auto rounded-md border border-[#25364d] bg-[#07101d] p-4 text-xs leading-6 text-slate-100">{report.pr_comment_draft}</pre>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Approval notes"
                className="mt-4 min-h-24 w-full resize-y rounded-md border border-[#31445f] bg-[#09111f] p-3 text-sm text-white placeholder:text-slate-500"
              />
              <div className="mt-4 flex flex-wrap gap-3">
                <Button onClick={() => void action("approve")}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
                <Button variant="danger" onClick={() => void action("reject")}>
                  <XCircle className="h-4 w-4" /> Reject
                </Button>
                <Button variant="secondary" disabled={selected.approval_status !== "approved"} onClick={() => void action("post")}>
                  <GitPullRequest className="h-4 w-4" /> Post to GitHub
                </Button>
              </div>
              {message ? <p className="mt-4 rounded-md border border-[#31445f] bg-[#091424] p-3 text-sm text-slate-200">{message}</p> : null}
            </div>
          ) : (
            <EmptyState title="Select a run" body="Choose a completed Terraform review to inspect the draft comment." />
          )}
        </Card>
      </div>
    </div>
  );
}
