"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FileText, RefreshCcw } from "lucide-react";
import { getReport, listRuns } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { presentRunListItem } from "@/lib/showcase";
import type { Report, RunListItem } from "@/types/api";
import { AlertBanner, Badge, Button, Card, EmptyState, SeverityBadge } from "@/components/ui";

export function ReportsCenter() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRuns() {
    setLoadingRuns(true);
    setError(null);
    try {
      const items = (await listRuns()).map(presentRunListItem);
      setRuns(items);
      setSelectedRunId((current) => current && items.some((run) => run.id === current) ? current : items[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load review reports.");
    } finally {
      setLoadingRuns(false);
    }
  }

  useEffect(() => {
    void loadRuns();
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setReport(null);
      return;
    }
    setLoadingReport(true);
    setError(null);
    getReport(selectedRunId)
      .then(setReport)
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoadingReport(false));
  }, [selectedRunId]);

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const metrics = useMemo(() => ({
    total: runs.length,
    approved: runs.filter((run) => run.approval_status === "approved").length,
    awaiting: runs.filter((run) => run.approval_status === "pending").length
  }), [runs]);

  function downloadReport() {
    if (!report || !selectedRun) return;
    const contents = [report.report_markdown, "", "---", "", "## GitHub PR comment draft", "", report.pr_comment_draft].join("\n");
    const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `terragate-report-${selectedRun.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 border-b border-[#24324a] pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">Evidence exports</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">Reports</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Inspect and export persisted review reports. Every report is tied to a real run, policy profile, finding set, and approval state.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void loadRuns()} disabled={loadingRuns} aria-busy={loadingRuns}>
          <RefreshCcw className={loadingRuns ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" /> Refresh
        </Button>
      </div>

      {error ? <AlertBanner tone="danger" title="Reports unavailable" onDismiss={() => setError(null)}>{error}</AlertBanner> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Persisted reports" value={metrics.total} />
        <Metric label="Approved" value={metrics.approved} />
        <Metric label="Awaiting decision" value={metrics.awaiting} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="border-b border-[#24324a] p-4">
            <h2 className="text-base font-semibold text-white">Review history</h2>
            <p className="mt-1 text-xs text-slate-500">Select a run to inspect its generated output.</p>
          </div>
          {loadingRuns && !runs.length ? (
            <div className="space-y-3 p-4" aria-busy="true">
              {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-md bg-[#101b2d]" />)}
            </div>
          ) : runs.length ? (
            <div className="max-h-[760px] space-y-2 overflow-y-auto p-3">
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  aria-pressed={run.id === selectedRunId}
                  className={`w-full rounded-md border p-3 text-left transition ${run.id === selectedRunId ? "border-[#43c6ac] bg-[#102237]" : "border-[#26364d] bg-[#091424] hover:border-[#3e587a]"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-xs font-semibold text-slate-200">{run.id}</span>
                    <SeverityBadge severity={run.risk_level} />
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-300">{run.summary}</p>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{run.environment} / {run.approval_status}</span>
                    <span>{formatDate(run.completed_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-4"><EmptyState title="No reports yet" body="Complete a Terraform review to generate the first report." /></div>
          )}
        </Card>

        <Card className="min-w-0 p-5">
          {loadingReport ? (
            <div className="space-y-4" aria-busy="true">
              <div className="h-8 w-64 animate-pulse rounded bg-[#17263d]" />
              <div className="h-[520px] animate-pulse rounded-md bg-[#101b2d]" />
            </div>
          ) : selectedRun && report ? (
            <div>
              <div className="flex flex-col justify-between gap-4 border-b border-[#24324a] pb-4 sm:flex-row sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="h-5 w-5 text-[#43c6ac]" aria-hidden="true" />
                    <h2 className="text-lg font-semibold text-white">Review report</h2>
                    <Badge tone={selectedRun.approval_status === "approved" ? "success" : "warn"}>{selectedRun.approval_status}</Badge>
                  </div>
                  <p className="mt-2 font-mono text-xs text-slate-500">{selectedRun.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/runs/${selectedRun.id}`} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#31445f] bg-[#142238] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-[#1b2b45]">Open run <ExternalLink className="h-4 w-4" aria-hidden="true" /></Link>
                  <Button type="button" onClick={downloadReport}><Download className="h-4 w-4" aria-hidden="true" /> Export Markdown</Button>
                </div>
              </div>
              <pre className="mt-5 max-h-[680px] overflow-auto whitespace-pre-wrap rounded-md border border-[#25364d] bg-[#07101d] p-4 text-xs leading-6 text-slate-100">{report.report_markdown}</pre>
            </div>
          ) : (
            <EmptyState title="Select a review" body="Choose a completed run to inspect and export its report." />
          )}
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </Card>
  );
}
