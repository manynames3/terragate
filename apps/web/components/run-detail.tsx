"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  Code2,
  Database,
  DollarSign,
  ExternalLink,
  FileDiff,
  GitPullRequest,
  History,
  LockKeyhole,
  RefreshCcw,
  ShieldAlert,
  XCircle
} from "lucide-react";
import {
  approveFixPatch,
  approveRun,
  commitFixPatch,
  getAuditLog,
  getCurrentUser,
  getFindings,
  getFixPatches,
  getReport,
  getRun,
  postGitHubComment,
  rejectRun
} from "@/lib/api";
import { cx, formatDate } from "@/lib/format";
import { canDecideReview, canPostReview } from "@/lib/review-actions";
import type { AuditLogEntry, AuthUser, Category, Finding, FixPatch, GitHubCommentResponse, Report, RunDetail, Severity } from "@/types/api";
import { AlertBanner, Badge, Button, Card, ConfirmDialog, EmptyState, LoadingPanel, SeverityBadge } from "@/components/ui";
import { PolicyBadge } from "@/components/review-workspace";
import { PlanEvidence } from "@/components/plan-evidence";
import { ExceptionRequestForm } from "@/components/exceptions";

const categoryFilters: Array<Category | "all"> = ["all", "security", "cost", "reliability", "governance", "compliance"];
const graphNodeLabels: Record<string, string> = {
  ingest_plan: "Ingest",
  validate_and_redact: "Redact",
  normalize_resource_changes: "Normalize",
  deterministic_policy_checks: "Policy",
  security_reviewer: "Security",
  cost_reviewer: "Cost",
  reliability_reviewer: "Reliability",
  governance_reviewer: "Governance",
  report_builder: "Report",
  human_approval_gate: "Approval"
};

type InspectorTab = "overview" | "evidence" | "remediation" | "runbook";
type Feedback = { tone: "success" | "danger" | "info"; text: string; href?: string };
type PendingConfirmation = { kind: "reject" | "post" | "commit_patch"; patchId?: string } | null;

export function RunDetailClient({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [fixPatches, setFixPatches] = useState<FixPatch[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | "all">("all");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [workspaceTab, setWorkspaceTab] = useState("overview");
  useEffect(() => {
    const readTab = () => { const tab = window.location.hash.slice(1); setWorkspaceTab(["overview","findings","plan","runbook","compliance","history"].includes(tab) ? tab : "overview"); setSelectedFindingId(new URLSearchParams(window.location.search).get("finding")); };
    readTab(); window.addEventListener("hashchange", readTab); window.addEventListener("popstate", readTab);
    return () => {window.removeEventListener("hashchange", readTab);window.removeEventListener("popstate", readTab);};
  }, []);

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setPartialWarning(null);
    try {
      const [[runData, findingData, reportData], optionalResults] = await Promise.all([
        Promise.all([getRun(runId), getFindings(runId), getReport(runId)]),
        Promise.allSettled([getFixPatches(runId), getAuditLog(runId)] as const)
      ]);
      const [patchResult, auditResult] = optionalResults;
      setRun(runData);
      setFindings(findingData);
      setReport(reportData);
      setFixPatches(patchResult.status === "fulfilled" ? patchResult.value : []);
      setAuditLog(auditResult.status === "fulfilled" ? auditResult.value : []);
      const unavailable = [patchResult.status === "rejected" ? "suggested patches" : null, auditResult.status === "rejected" ? "audit history" : null].filter(Boolean);
      if (unavailable.length) setPartialWarning(`The run loaded, but ${unavailable.join(" and ")} could not be refreshed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run.");
    } finally {
      if (background) setRefreshing(false);
      else setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    getCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  const runStatus = run?.status;

  useEffect(() => {
    if (!runStatus || !["queued", "running"].includes(runStatus)) return;
    const interval = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(interval);
  }, [load, runStatus]);

  useEffect(() => {
    if (!findings.length) {
      setSelectedFindingId(null);
      return;
    }
    if (!selectedFindingId || !findings.some((finding) => finding.id === selectedFindingId)) {
      setSelectedFindingId(findings[0].id);
    }
  }, [findings, selectedFindingId]);

  const filteredFindings = useMemo(
    () => (category === "all" ? findings : findings.filter((finding) => finding.category === category)),
    [category, findings]
  );

  const selectedFinding = useMemo(() => {
    return filteredFindings.find((finding) => finding.id === selectedFindingId) ?? filteredFindings[0] ?? null;
  }, [filteredFindings, selectedFindingId]);

  const categoryCounts = useMemo(() => {
    return findings.reduce<Record<string, number>>((acc, finding) => {
      acc[finding.category] = (acc[finding.category] ?? 0) + 1;
      return acc;
    }, {});
  }, [findings]);

  const runbookItems = useMemo(() => buildRunbookItems(selectedFinding, findings, run), [selectedFinding, findings, run]);
  const canReview = currentUser?.role === "reviewer" || currentUser?.role === "platform-admin";
  const canCommit = currentUser?.role === "platform-admin";

  async function runAction(action: "approve" | "reject" | "post") {
    if (action === "reject" && !notes.trim()) {
      setFeedback({ tone: "danger", text: "Add a rejection reason so the change author knows what must be addressed." });
      return;
    }
    setActionLoading(true);
    setFeedback(null);
    try {
      if (action === "approve") {
        if (!report) return;
        await approveRun(runId, notes, report.review_snapshot_hash);
        setFeedback({ tone: "success", text: "PR comment draft approved." });
      }
      if (action === "reject") {
        if (!report) return;
        await rejectRun(runId, notes, report.review_snapshot_hash);
        setFeedback({ tone: "success", text: "PR comment draft rejected and the decision was added to the audit trail." });
      }
      if (action === "post") {
        const result: GitHubCommentResponse = await postGitHubComment(runId);
        setFeedback({ tone: result.mock ? "info" : "success", text: result.comment_url ? "Comment posted to GitHub." : result.message, href: result.comment_url ?? undefined });
      }
      await load(true);
    } catch (err) {
      setFeedback({ tone: "danger", text: err instanceof Error ? err.message : "Action failed." });
    } finally {
      setActionLoading(false);
    }
  }

  function selectFinding(finding: Finding) {
    setSelectedFindingId(finding.id);
    setInspectorTab("overview");
    const url = new URL(window.location.href);
    url.searchParams.set("finding", finding.id);
    url.hash = "findings";
    window.history.replaceState(null, "", url);
    window.setTimeout(() => document.getElementById("finding-inspector")?.scrollIntoView({behavior:"smooth",block:"nearest"}), 0);
  }

  async function approvePatch(patchId: string) {
    setActionLoading(true);
    setFeedback(null);
    try {
      const patch = fixPatches.find((item) => item.id === patchId);
      if (!patch || patch.kind !== "patch") return;
      await approveFixPatch(runId, patchId, patch.review_snapshot_hash);
      setFeedback({ tone: "success", text: "Suggested patch approved for implementation." });
      await load(true);
    } catch (err) {
      setFeedback({ tone: "danger", text: err instanceof Error ? err.message : "Patch approval failed." });
    } finally {
      setActionLoading(false);
    }
  }

  async function commitPatch(patchId: string) {
    setActionLoading(true);
    setFeedback(null);
    try {
      const result = await commitFixPatch(runId, patchId);
      setFeedback({ tone: result.commit_url ? "success" : "info", text: result.commit_url ? "Patch committed to the pull request branch." : result.message, href: result.commit_url ?? undefined });
      await load(true);
    } catch (err) {
      setFeedback({ tone: "danger", text: err instanceof Error ? err.message : "Patch commit failed." });
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmPendingAction() {
    const pending = pendingConfirmation;
    if (!pending) return;
    if (pending.kind === "reject") await runAction("reject");
    if (pending.kind === "post") await runAction("post");
    if (pending.kind === "commit_patch" && pending.patchId) await commitPatch(pending.patchId);
    setPendingConfirmation(null);
  }

  if (loading && !run) {
    return <LoadingPanel label="Loading review evidence" />;
  }
  if (!run || !report) {
    return (
      <Card className="p-6">
        <AlertBanner tone="danger" title="Review unavailable">{error ?? "This review could not be found."}</AlertBanner>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" onClick={() => void load(false)}>Try again</Button>
          <Link href="/overview" className="inline-flex min-h-10 items-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-4 text-sm font-semibold text-slate-900">Back to overview</Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <AlertBanner tone="danger" title="Refresh failed" onDismiss={() => setError(null)}>{error}</AlertBanner> : null}
      {partialWarning ? <AlertBanner tone="warning" title="Some run data is unavailable" onDismiss={() => setPartialWarning(null)}>{partialWarning}</AlertBanner> : null}
      <RunHeader run={run} refreshing={refreshing} onRefresh={() => void load(true)} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3"><PolicyBadge decision={run.policy_decision} /><p className="text-sm text-slate-600">{run.assessment_state === "assessed" ? `${run.blocking_findings} blocking findings · ${run.accepted_findings} accepted risks` : "Assessment is not available yet"}</p></div>
        <p className="text-xs text-slate-500">Merge enforcement not verified · No deployment authorization</p>
      </div>
      <nav aria-label="Review sections" className="flex gap-5 overflow-x-auto border-b border-[var(--border)]">
        {["overview","findings","plan","runbook","compliance","history"].map(tab => <a key={tab} href={`#${tab}`} aria-current={workspaceTab === tab ? "page" : undefined} className={cx("shrink-0 border-b-2 px-1 py-3 text-sm font-medium capitalize", workspaceTab === tab ? "border-teal-700 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-900")}>{tab}</a>)}
      </nav>
      {workspaceTab === "overview" ? <>
      <RiskCommandStrip run={run} findings={findings} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
            <GraphProgressPanel run={run} />
            <CommentDraftPanel report={report} />
            <Link href="#findings" className="inline-flex min-h-10 items-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-teal-700">Inspect {findings.length} findings and remediation</Link>
        </div>

        <div className="space-y-4">
          <ApprovalRail
            run={run}
            report={report}
            notes={notes}
            setNotes={setNotes}
            feedback={feedback}
            actionLoading={actionLoading}
            canReview={canReview}
            onApprove={() => void runAction("approve")}
            onReject={() => setPendingConfirmation({ kind: "reject" })}
            onPost={() => setPendingConfirmation({ kind: "post" })}
          />
          <RunMetadataPanel run={run} />
          <GitHubContextPanel run={run} />
        </div>

      </div>
      </> : null}
      {workspaceTab === "findings" ? <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0 space-y-5"><FindingsCommandTable findings={filteredFindings} allFindings={findings} category={category} setCategory={setCategory} categoryCounts={categoryCounts} selectedFindingId={selectedFinding?.id ?? null} onSelect={selectFinding} />
        <PatchWorkflowPanel patches={fixPatches} actionLoading={actionLoading} canApprove={canReview} canCommit={canCommit} onApprove={approvePatch} onCommit={patchId=>setPendingConfirmation({kind:"commit_patch",patchId})} /></div>
        <div id="finding-inspector" className="min-w-0 scroll-mt-6"><FindingInspector finding={selectedFinding} tab={inspectorTab} setTab={setInspectorTab} runId={run.id} />{selectedFinding ? <div className="mt-5 rounded-lg border border-[var(--border)] bg-white p-5"><ExceptionRequestForm key={selectedFinding.id} runId={run.id} findingId={selectedFinding.id} snapshotHash={report.review_snapshot_hash} disabled={!canReview || run.assessment_state!=="assessed"} onCreated={()=>void load(true)} /></div> : null}</div>
      </div> : null}
      {workspaceTab === "plan" ? <PlanEvidence runId={run.id} /> : null}
      {workspaceTab === "runbook" ? <div className="space-y-4"><RunbookChecklistPanel items={runbookItems} /><Link className="inline-flex min-h-10 items-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-teal-700" href={`/runbooks?run=${run.id}`}>Open operational checklist and progress</Link></div> : null}
      {workspaceTab === "compliance" ? <div className="space-y-4"><AlertBanner title="Evidence mapping, not a certification">These mappings cover only the evaluated plan changes, not your full cloud estate.</AlertBanner>{findings.some(f=>f.compliance_refs.length) ? <Card className="divide-y divide-[var(--border)]">{findings.filter(f=>f.compliance_refs.length).map(f=><div key={f.id} className="p-4"><p className="text-sm font-semibold">{f.title}</p><p className="mt-2 text-xs text-slate-600">{f.compliance_refs.join(" · ")}</p></div>)}</Card> : <EmptyState title="No mapped findings" body="No evaluated finding has a compliance reference. This is not evidence of certification." />}<Link href={`/compliance?run=${run.id}`} className="inline-flex min-h-10 items-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-teal-700">Open control checklist</Link></div> : null}
      {workspaceTab === "history" ? <div className="space-y-4"><AuditPanel auditLog={auditLog} /><Link href="/exceptions" className="inline-flex min-h-10 items-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-teal-700">Inspect risk exception decisions</Link></div> : null}
      <ConfirmDialog
        open={pendingConfirmation !== null}
        title={confirmationTitle(pendingConfirmation)}
        description={confirmationDescription(pendingConfirmation)}
        confirmLabel={confirmationLabel(pendingConfirmation)}
        tone={pendingConfirmation?.kind === "reject" ? "danger" : "primary"}
        busy={actionLoading}
        confirmDisabled={pendingConfirmation?.kind === "reject" && !notes.trim()}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={() => void confirmPendingAction()}
      >
        {pendingConfirmation?.kind === "reject" && !notes.trim() ? (
          <AlertBanner tone="warning">A rejection reason is required. Cancel and add notes before continuing.</AlertBanner>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function RunHeader({ run, refreshing, onRefresh }: { run: RunDetail; refreshing: boolean; onRefresh: () => void }) {
  const title = getRunTitle(run);
  const repo = run.github_pr_context?.repo_full_name ?? [run.repo_owner, run.repo_name].filter(Boolean).join("/") ?? "Repository unavailable";
  return (
    <header className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 px-5 py-5 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">Runs / {run.id}</p>
          <div className="mt-3 flex min-w-0 items-center gap-3">
            <GitPullRequest className="h-6 w-6 shrink-0 text-slate-900" />
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-normal text-slate-950 md:text-3xl">{title}</h1>
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{run.summary}</p>
          <div className="mt-5 grid grid-cols-2 gap-4 text-xs text-slate-600 sm:grid-cols-3 2xl:grid-cols-6">
            <HeaderMeta label="Repository" value={repo || "not attached"} />
            <HeaderMeta label="Environment" value={run.environment} badgeTone={run.environment === "prod" ? "danger" : "neutral"} />
            <HeaderMeta label="Provider" value={run.cloud_provider.toUpperCase()} />
            <HeaderMeta label="Policy profile" value={run.policy_profile} badgeTone="neutral" />
            <HeaderMeta label="Triggered" value={formatDate(run.created_at)} />
            <HeaderMeta label="Duration" value={computeDuration(run.created_at, run.completed_at)} />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <CheckState run={run} />
          <Badge tone={run.risk_level === "critical" ? "danger" : run.risk_level === "high" ? "warn" : "info"}>
            Overall risk: {run.risk_level.replaceAll("_", " ")}
          </Badge>
          <Link
            href="/reviews/new"
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-sm font-semibold text-slate-900 transition hover:bg-[var(--surface-muted)]"
          >
            New review
          </Link>
          <Button type="button" variant="secondary" className="min-h-9 px-3" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing}>
            <RefreshCcw className={cx("h-4 w-4", refreshing && "animate-spin")} /> {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        </div>
      </div>
    </header>
  );
}

function HeaderMeta({ label, value, badgeTone }: { label: string; value: string; badgeTone?: "neutral" | "success" | "warn" | "danger" | "info" }) {
  return (
    <div className="min-w-0 border-l border-[var(--border)] pl-3 first:border-l-0 first:pl-0 sm:first:border-l sm:first:pl-3 lg:first:border-l-0 lg:first:pl-0">
      <p className="break-words uppercase tracking-normal text-slate-500">{label}</p>
      {badgeTone ? (
        <div className="mt-1">
          <Badge tone={badgeTone}>{value}</Badge>
        </div>
      ) : (
        <p className="mt-1 truncate font-medium text-slate-900">{value}</p>
      )}
    </div>
  );
}

function CheckState({ run }: { run: RunDetail }) {
  const state = run.github_check?.check_url ? run.github_check.state : "pending";
  const completed = state === "pass";
  return (
    <span className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-xs font-medium text-slate-700">
      <span className={cx("h-2.5 w-2.5 rounded-full", completed ? "bg-emerald-400" : state === "fail" ? "bg-red-400" : state === "warn" ? "bg-amber-300" : "bg-slate-500")} />
      GitHub check {run.github_check?.check_url ? run.github_check.status : "not published"}
    </span>
  );
}

function RiskCommandStrip({ run, findings }: { run: RunDetail; findings: Finding[] }) {
  const hasCost = typeof run.cost_estimate.monthly_delta === "number" && Number.isFinite(run.cost_estimate.monthly_delta);
  const hasBlastAnalysis = Boolean(run.blast_radius.summary);
  const criticalStateful = run.blast_radius.stateful_changes?.filter((item) => item.severity === "critical").length ?? 0;
  const blastResourceCount = run.blast_radius.stateful_changes?.length ?? 0;
  const blastResourceLabel = !hasBlastAnalysis ? "Not analyzed" : blastResourceCount === 0
    ? "No stateful destructive changes"
    : `${criticalStateful || blastResourceCount} ${criticalStateful ? "critical" : "stateful"} resources`;
  const rawArtifacts = run.artifacts.filter((artifact) => !artifact.redacted).length;
  const redactedArtifacts = run.artifacts.filter((artifact) => artifact.redacted).length;
  return (
    <section className="grid overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm lg:grid-cols-5">
      <SummaryTile label="Risk score" icon={<ShieldAlert className="h-4 w-4" />}>
        <div className="flex items-end gap-1">
          <span className={cx("font-semibold", run.risk_score !== null ? "text-3xl" : "text-lg", severityTextTone(run.risk_level))}>{run.risk_score ?? (run.assessment_state === "unavailable" ? "Unavailable" : "Not assessed")}</span>
          {run.risk_score !== null ? <span className="pb-1 text-lg text-slate-600">/100</span> : null}
        </div>
        <p className={cx("mt-2 text-sm font-semibold capitalize", severityTextTone(run.risk_level))}>{run.risk_score !== null ? `${run.risk_level} risk` : "No completed assessment"}</p>
      </SummaryTile>

      <SummaryTile label="Severity breakdown" icon={<Activity className="h-4 w-4" />}>
        <div className="grid grid-cols-5 gap-2">
          {(["critical", "high", "medium", "low", "info"] as Severity[]).map((severity) => (
            <div key={severity}>
              <p className={cx("text-2xl font-semibold", severityTextTone(severity))}>{run.severity_counts[severity] ?? 0}</p>
              <p className="mt-1 text-[11px] capitalize text-slate-500">{severity}</p>
            </div>
          ))}
        </div>
      </SummaryTile>

      <SummaryTile label={`Cost delta (${run.cloud_provider.toUpperCase()})`} icon={<DollarSign className="h-4 w-4" />}>
        <p className="text-3xl font-semibold text-amber-800">
          {hasCost ? formatMoney(run.cost_estimate.monthly_delta!) : "Not estimated"}
          {hasCost ? <span className="ml-1 text-sm font-normal text-slate-600">/mo</span> : null}
        </p>
        {hasCost ? <p className="mt-2 text-sm text-amber-800">{formatMoney(run.cost_estimate.annual_delta ?? run.cost_estimate.monthly_delta! * 12)} /yr</p> : null}
        <p className="mt-2 text-xs text-slate-600">{run.cost_estimate.source?.replaceAll("_", " ") ?? "No cost result returned"}</p>
      </SummaryTile>

      <SummaryTile label="Blast radius" icon={<Database className="h-4 w-4" />}>
        <p className="text-base font-semibold text-red-800">{blastResourceLabel}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{run.blast_radius.summary ?? "No blast-radius result returned."}</p>
        {hasBlastAnalysis ? <p className="mt-2 text-sm font-semibold capitalize text-red-800">{run.blast_radius.level}</p> : null}
      </SummaryTile>

      <SummaryTile label="Data handling" icon={<LockKeyhole className="h-4 w-4" />}>
        <div className="space-y-2 text-sm">
          <DataState label="Raw artifact" value={`${rawArtifacts} stored`} tone="warn" />
          <DataState label="Redacted artifact" value={`${redactedArtifacts} available`} tone={redactedArtifacts ? "success" : "warn"} />
          <DataState label="Findings" value={`${findings.length} persisted`} tone="info" />
        </div>
      </SummaryTile>
    </section>
  );
}

function SummaryTile({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-36 border-b border-[var(--border)] p-4 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-normal text-slate-600">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function DataState({ label, value, tone }: { label: string; value: string; tone: "success" | "warn" | "info" }) {
  const toneClass = tone === "success" ? "text-emerald-800" : tone === "warn" ? "text-amber-800" : "text-sky-800";
  return (
    <div className="flex items-start gap-2">
      <span className={cx("mt-1.5 h-2 w-2 rounded-full", tone === "success" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-300" : "bg-sky-300")} />
      <span>
        <span className="block text-xs text-slate-600">{label}</span>
        <span className={cx("text-xs font-medium", toneClass)}>{value}</span>
      </span>
    </div>
  );
}

function FindingsCommandTable({
  findings,
  allFindings,
  category,
  setCategory,
  categoryCounts,
  selectedFindingId,
  onSelect
}: {
  findings: Finding[];
  allFindings: Finding[];
  category: Category | "all";
  setCategory: (category: Category | "all") => void;
  categoryCounts: Record<string, number>;
  selectedFindingId: string | null;
  onSelect: (finding: Finding) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">Findings ({allFindings.length})</p>
          <h2 className="mt-1 text-base font-semibold text-slate-950">Evidence-backed infrastructure risks</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {categoryFilters.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => setCategory(item)}
              aria-pressed={category === item}
              className={cx(
                "inline-flex min-h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium capitalize transition",
                category === item
                  ? "border-[#0f766e] bg-[#0f766e]/14 text-[#0f766e]"
                  : "border-[var(--border)] bg-[var(--surface)] text-slate-600 hover:bg-[var(--surface-muted)] hover:text-slate-900"
              )}
            >
              {item}
              <span className="rounded bg-white/8 px-1.5 text-[10px]">{item === "all" ? allFindings.length : categoryCounts[item] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {findings.length === 0 ? (
        <div className="p-5">
          <EmptyState title="No findings in this view" body="The selected category has no findings for this run." />
        </div>
      ) : (
        <>
          <div className="divide-y divide-[var(--border)] md:hidden">
            {findings.map((finding) => {
              const selected = finding.id === selectedFindingId;
              return (
                <button
                  key={finding.id}
                  type="button"
                  onClick={() => onSelect(finding)}
                  aria-pressed={selected}
                  className={cx("block w-full px-4 py-4 text-left transition", selected ? "bg-[#eff6ff]" : "hover:bg-[var(--surface-muted)]")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-950">{finding.title}</p>
                      <p className="mt-2 truncate font-mono text-xs text-slate-600">{finding.resource_address ?? "resource not mapped"}</p>
                    </div>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <Badge tone="neutral">{finding.category}</Badge>
                    <span>{Math.round(finding.confidence * 100)}% confidence</span>
                    {finding.requires_human_review ? <Badge tone="warn">human review</Badge> : null}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[660px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-[11px] uppercase tracking-normal text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3"></th>
                <th className="px-3 py-3">Severity</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3">Resource</th>
                <th className="hidden px-3 py-3 2xl:table-cell">File</th>
                <th className="px-3 py-3">Confidence</th>
                <th className="hidden px-3 py-3 2xl:table-cell">Source</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((finding) => {
                const selected = finding.id === selectedFindingId;
                return (
                  <tr
                    key={finding.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onClick={() => onSelect(finding)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(finding);
                      }
                    }}
                    className={cx(
                      "cursor-pointer border-b border-[var(--border)] transition last:border-0",
                      selected ? "bg-[#eff6ff] outline outline-1 outline-[#0f766e]" : "hover:bg-[var(--surface-muted)]"
                    )}
                  >
                    <td className="px-4 py-3">
                      <span className={cx("flex h-4 w-4 items-center justify-center rounded border", selected ? "border-[#0f766e] bg-[#0f766e] text-white" : "border-[var(--border)]")}>
                        {selected ? <CheckCircle2 className="h-3 w-3" /> : null}
                      </span>
                    </td>
                    <td className="px-3 py-3"><SeverityBadge severity={finding.severity} /></td>
                    <td className="px-3 py-3 capitalize text-slate-600">{finding.category}</td>
                    <td className="px-3 py-3 font-medium text-slate-950">{finding.title}</td>
                    <td className="max-w-44 truncate px-3 py-3 font-mono text-xs text-slate-600">{finding.resource_address ?? "n/a"}</td>
                    <td className="hidden max-w-36 truncate px-3 py-3 font-mono text-xs text-slate-600 2xl:table-cell">{finding.pr_file_path ?? "not mapped"}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-9 text-xs text-slate-600">{Math.round(finding.confidence * 100)}%</span>
                        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--border)]">
                          <span className="block h-full rounded-full bg-[#0f766e]" style={{ width: `${Math.round(finding.confidence * 100)}%` }} />
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 text-xs text-slate-600 2xl:table-cell">{finding.source.replaceAll("_", " ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}
      <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs text-slate-500">
        <span>{findings.length ? `1-${findings.length} of ${findings.length} results` : "0 results"}</span>
        <span>{allFindings.filter((finding) => finding.requires_human_review).length} require human review</span>
      </div>
    </Card>
  );
}

function ApprovalRail({
  run,
  report,
  notes,
  setNotes,
  feedback,
  actionLoading,
  canReview,
  onApprove,
  onReject,
  onPost
}: {
  run: RunDetail;
  report: Report;
  notes: string;
  setNotes: (notes: string) => void;
  feedback: Feedback | null;
  actionLoading: boolean;
  canReview: boolean;
  onApprove: () => void;
  onReject: () => void;
  onPost: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">Approval status</p>
          <h2 className="mt-2 text-lg font-semibold text-amber-800">{run.approval_status === "approved" ? report.approval_valid ? "Approved" : "Approval expired" : run.approval_status === "rejected" ? "Rejected" : "Approval required"}</h2>
        </div>
        <Badge tone={run.approval_status === "approved" ? "success" : run.approval_status === "rejected" ? "danger" : "warn"}>{run.approval_status}</Badge>
      </div>
      <p className="mt-2 text-sm leading-5 text-slate-600">
        {run.approval_status === "approved"
          ? report.approval_valid ? "Approval covers this exact saved draft, artifact hashes, policy snapshot, and reviewed PR commit." : "The review changed or its approval predates versioned checks. Inspect the current draft and approve again."
          : run.approval_status === "rejected"
            ? "This review has been rejected. Record new approval notes before re-approving."
            : "A reviewer must approve the saved draft before posting to GitHub. Remediation snippets are export-only."}
      </p>
      {report.decision_blocker ? <p className="mt-3 text-xs leading-5 text-amber-800">{report.decision_blocker}</p> : null}
      <div className="mt-4 grid gap-2">
        <Button onClick={onApprove} disabled={actionLoading || !canReview || !canDecideReview(run, report) || report.approval_valid} className="w-full">
          <CheckCircle2 className="h-4 w-4" /> {report.approval_valid ? "Approved" : "Approve comment"}
        </Button>
        <Button variant="secondary" onClick={onReject} disabled={actionLoading || !canReview || !canDecideReview(run, report) || run.approval_status === "rejected"} className="w-full">
          <XCircle className="h-4 w-4" /> {run.approval_status === "rejected" ? "Rejected" : "Reject comment"}
        </Button>
        <Button variant="secondary" onClick={onPost} disabled={actionLoading || !canReview || !canPostReview(run, report)} className="w-full">
          <GitPullRequest className="h-4 w-4" /> Post to GitHub
        </Button>
      </div>
      {!canReview ? <p className="mt-3 text-xs leading-5 text-amber-800">Reviewer or platform administrator access is required for decisions and GitHub comments.</p> : null}
      <label className="mt-5 block">
        <span className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">Approval notes</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Add notes for approval..."
          className="mt-2 min-h-24 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-slate-950 placeholder:text-slate-500"
        />
      </label>
      {feedback ? <div className="mt-4"><AlertBanner tone={feedback.tone}>{feedback.text}{feedback.href ? <a href={feedback.href} target="_blank" rel="noreferrer" className="ml-1 font-semibold underline underline-offset-2">Open in GitHub</a> : null}</AlertBanner></div> : null}
    </Card>
  );
}

function RunMetadataPanel({ run }: { run: RunDetail }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">Run metadata</p>
      <div className="mt-3 space-y-2">
        <RailMetric label="Run ID" value={run.id} mono />
        <RailMetric label="Policy content version" value={run.policy_version ?? "Unavailable"} mono />
        <RailMetric label="Reviewed commit" value={run.reviewed_head_sha ?? "Not attached"} mono />
        <RailMetric label="Artifacts" value={String(run.artifacts.length)} />
        <RailMetric label="Graph progress" value={`${run.graph_progress.length} nodes`} />
        <RailMetric label="Trace ID" value={run.trace_id ?? "Not recorded"} mono />
      </div>
    </Card>
  );
}

function GitHubContextPanel({ run }: { run: RunDetail }) {
  const context = run.github_pr_context;
  const hasRepo = context || run.repo_owner;
  if (!hasRepo) {
    return (
      <Card className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">GitHub context</p>
        <p className="mt-3 text-sm leading-5 text-slate-600">No GitHub PR context was attached to this run.</p>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <GitPullRequest className="h-4 w-4 text-[#2563eb]" />
        <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">GitHub PR context</p>
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-950">{context?.title ?? `${run.repo_owner}/${run.repo_name}#${run.pull_number}`}</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">{context?.message ?? "Repository metadata attached to this review."}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <RailMetric label="Source" value={context?.mock ? "Unavailable / mock" : context?.available ? "Live GitHub" : "Unavailable"} />
        <RailMetric label="Files" value={context?.available && !context.mock ? String(context.changed_files_count) : "Unavailable"} />
        <RailMetric label="Terraform" value={context?.available && !context.mock ? String(context.terraform_files.length) : "Unavailable"} />
        <RailMetric label="Diff" value={context?.available && !context.mock ? `+${context.additions} / -${context.deletions}` : "Unavailable"} />
      </div>
      {context?.html_url ? (
        <a href={context.html_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#0f766e]">
          Open pull request <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </Card>
  );
}

function RailMetric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-normal text-slate-500">{label}</p>
      <p className={cx("mt-1 truncate text-xs font-medium text-slate-900", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function FindingInspector({ finding, tab, setTab, runId }: { finding: Finding | null; tab: InspectorTab; setTab: (tab: InspectorTab) => void; runId: string }) {
  if (!finding) {
    return (
      <Card className="min-h-[540px] p-5">
        <EmptyState title="No finding selected" body="Select a finding to inspect evidence, impact, remediation, and runbook steps." />
      </Card>
    );
  }

  const evidence = finding.evidence[0];
  return (
    <aside className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] shadow-sm 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-2rem)] 2xl:overflow-y-auto">
      <div className="border-b border-[var(--border)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className={cx("h-5 w-5", severityTextTone(finding.severity))} />
              <SeverityBadge severity={finding.severity} />
            </div>
            <h2 className="mt-4 text-xl font-semibold text-slate-950">{finding.title}</h2>
            <p className="mt-1 text-sm capitalize text-slate-600">{finding.category} / {finding.severity}</p>
            <p className="mt-3 break-words text-xs text-slate-600">{evidence?.rule_id ?? "Rule ID not captured"} · {Math.round(finding.confidence * 100)}% confidence · {finding.source.replaceAll("_", " ")}</p>
            {finding.requires_human_review ? <div className="mt-2"><Badge tone="warn">Verification required</Badge></div> : null}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-4 border-b border-[var(--border)] text-xs">
          {(["overview", "evidence", "remediation", "runbook"] as InspectorTab[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              aria-pressed={tab === item}
              className={cx(
                "border-b px-1 pb-3 text-center capitalize transition",
                tab === item ? "border-[#0f766e] text-[#0f766e]" : "border-transparent text-slate-500 hover:text-slate-700"
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5 p-5">
        {tab === "overview" ? (
          <>
            <InspectorBlock title="Description" body={finding.description} />
            <InspectorBlock title="Resource">
              <p className="break-all font-mono text-sm text-slate-700">{finding.resource_address ?? "resource not mapped"}</p>
              <p className="mt-2 break-all text-xs text-slate-500">{finding.resource_type ?? "unknown resource type"} / {finding.provider ?? "unknown provider"}</p>
            </InspectorBlock>
            <InspectorBlock title="PR file (heuristic mapping)">
              {finding.pr_file_url ? (
                <a href={finding.pr_file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-sm text-[#0f766e] hover:text-slate-950">
                  <span className="min-w-0 break-all">{finding.pr_file_path}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <p className="font-mono text-sm text-slate-700">{finding.pr_file_path ?? "not mapped to a PR file"}</p>
              )}
            </InspectorBlock>
            <InspectorBlock title="Impact" body={finding.impact || "This finding is tied to deployable Terraform evidence and should be reviewed before apply."} />
            <InspectorBlock title="Recommendation" body={finding.recommendation} />
          </>
        ) : null}

        {tab === "evidence" ? (
          <>
            <InspectorBlock title="Evidence excerpt">
              <pre className="max-h-72 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs leading-6 text-slate-700">{formatEvidenceJson(finding)}</pre>
            </InspectorBlock>
            <InspectorBlock title="JSON path">
              <p className="font-mono text-xs text-slate-700">{evidence?.json_path ?? "n/a"}</p>
            </InspectorBlock>
            <InspectorBlock title="Observed value">
              <p className="break-words rounded-md bg-[var(--surface-muted)] p-3 font-mono text-xs text-slate-700">{stringifyValue(evidence?.observed_value ?? "n/a")}</p>
            </InspectorBlock>
            <InspectorBlock title="Expected value">
              <p className="break-words rounded-md bg-[var(--surface-muted)] p-3 font-mono text-xs text-slate-700">{stringifyValue(evidence?.expected_value ?? "n/a")}</p>
            </InspectorBlock>
            <InspectorBlock title="Rule" body={`${evidence?.rule_id ?? "n/a"} - ${evidence?.explanation ?? ""}`} />
            <InspectorBlock title="Rule implementation version" body={finding.rule_version ?? "Not captured for this historical finding"} />
            {finding.resource_address ? <PlanEvidence runId={runId} resource={finding.resource_address} /> : null}
          </>
        ) : null}

        {tab === "remediation" ? (
          <>
            <InspectorBlock title="Recommendation" body={finding.recommendation} />
            {finding.remediation ? (
              <>
                <InspectorBlock title="Suggested change">
                  <p className="text-sm leading-6 text-slate-600">{finding.remediation.explanation}</p>
                  <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs leading-6 text-slate-900">{finding.remediation.snippet}</pre>
                </InspectorBlock>
                <InspectorBlock title="Risk of change" body={finding.remediation.risk_of_change} />
              </>
            ) : (
              <InspectorBlock title="Suggested change" body="No remediation snippet was generated for this finding." />
            )}
          </>
        ) : null}

        {tab === "runbook" ? (
          <>
            <InspectorBlock title="Operational checklist">
              {finding.runbook_checklist.length ? (
                <ul className="space-y-2 text-sm text-slate-700">
                  {finding.runbook_checklist.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#0f766e]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-600">No runbook steps were generated for this finding.</p>
              )}
            </InspectorBlock>
            <InspectorBlock title="Compliance" body={finding.compliance_refs.join(", ") || "Internal TerraGate policy"} />
            <InspectorBlock title="Confidence">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-[#0f766e]">{Math.round(finding.confidence * 100)}%</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
                  <span className="block h-full rounded-full bg-[#0f766e]" style={{ width: `${Math.round(finding.confidence * 100)}%` }} />
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">{finding.source.replaceAll("_", " ")} via {finding.reviewer_node}</p>
            </InspectorBlock>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function InspectorBlock({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--border)] pb-4 last:border-b-0 last:pb-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">{title}</h3>
      {body ? <p className="mt-3 break-words text-sm leading-6 text-slate-600">{body}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

function GraphProgressPanel({ run }: { run: RunDetail }) {
  const steps = run.graph_progress.length ? run.graph_progress : [{ node: "queued", status: run.status, timestamp: run.created_at }];
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#0f766e]" />
          <h2 className="text-sm font-semibold text-slate-950">Graph progress</h2>
        </div>
        <Badge tone="neutral">{steps.length} nodes</Badge>
      </div>
      <div className="mt-7 flex items-start gap-1 overflow-x-auto pb-1">
        {steps.map((step, index) => {
          const complete = step.status === "completed";
          return (
            <div key={`${step.node}-${step.timestamp}-${index}`} className="flex min-w-[70px] flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span className={cx("h-px flex-1", index === 0 ? "bg-transparent" : "bg-[var(--border)]")} />
                <span className={cx("flex h-5 w-5 items-center justify-center rounded-full border", complete ? "border-[#0f766e] bg-[#eff6ff] text-[#0f766e]" : "border-slate-500 text-slate-500")}>
                  {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3 w-3" />}
                </span>
                <span className={cx("h-px flex-1", index === steps.length - 1 ? "bg-transparent" : "bg-[var(--border)]")} />
              </div>
              <p className="mt-2 truncate text-center text-[10px] font-medium text-slate-600">{graphNodeLabels[step.node] ?? step.node.replaceAll("_", " ")}</p>
              <p className="mt-1 text-center text-[10px] text-slate-500">{step.status.replaceAll("_", " ")}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-slate-500">Completed {steps.filter((step) => step.status === "completed").length} / {steps.length} / {computeDuration(run.created_at, run.completed_at)}</p>
    </Card>
  );
}

function CommentDraftPanel({ report }: { report: Report }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-[#2563eb]" />
          <h2 className="text-sm font-semibold text-slate-950">PR comment draft</h2>
        </div>
        <Badge tone="neutral">Preview</Badge>
      </div>
      {report.pr_comment_draft ? (
        <pre className="mt-4 max-h-52 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-[11px] leading-5 text-slate-900">{report.pr_comment_draft}</pre>
      ) : (
        <div className="mt-4">
          <EmptyState title="No draft generated" body="The report builder has not produced a PR comment for this run." />
        </div>
      )}
    </Card>
  );
}

function RunbookChecklistPanel({ items }: { items: string[] }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-950">Runbook checklist</h2>
        <Badge tone="neutral">{items.length}</Badge>
      </div>
      {items.length ? (
        <ul className="mt-4 space-y-3">
          {items.slice(0, 6).map((item) => (
            <li key={item} className="flex gap-2 text-xs leading-5 text-slate-600">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-[#0f766e]" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm leading-5 text-slate-600">No runbook checklist items were generated for the selected finding.</p>
      )}
    </Card>
  );
}

function PatchWorkflowPanel({
  patches,
  actionLoading,
  canApprove,
  canCommit,
  onApprove,
  onCommit
}: {
  patches: FixPatch[];
  actionLoading: boolean;
  canApprove: boolean;
  canCommit: boolean;
  onApprove: (patchId: string) => Promise<void>;
  onCommit: (patchId: string) => void;
}) {
  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <FileDiff className="h-4 w-4 text-[#0f766e]" />
        <h2 className="text-sm font-semibold text-slate-950">Export-only remediation</h2>
      </div>
      {patches.length ? (
        <div className="max-h-[560px] space-y-3 overflow-y-auto">
          {patches.map((patch) => (
            <div key={patch.id} className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                <div className="min-w-0">
                  <Badge tone={patch.kind === "patch" && (patch.status === "approved" || patch.status === "committed") ? "success" : "neutral"}>{patch.kind === "snippet" ? "Guidance" : patch.status}</Badge>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{patch.summary}</p>
                  <p className="mt-1 truncate font-mono text-xs text-slate-500">{patch.pr_file_path ?? "file not mapped"}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant="secondary" className="min-h-8 px-3 text-xs" onClick={() => downloadRemediation(patch)}>
                    <Download className="h-3.5 w-3.5" /> Export {patch.kind === "snippet" ? "snippet" : "patch"}
                  </Button>
                  {patch.kind === "patch" ? <>
                  <Button variant="secondary" className="min-h-8 px-3 text-xs" disabled={actionLoading || !canApprove || patch.status === "approved" || patch.status === "committed"} onClick={() => void onApprove(patch.id)}>
                    Approve
                  </Button>
                  <Button className="min-h-8 px-3 text-xs" disabled={actionLoading || !canCommit || patch.status !== "approved"} onClick={() => void onCommit(patch.id)}>
                    Commit
                  </Button>
                  </> : null}
                </div>
              </div>
              <details className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600">{patch.kind === "snippet" ? "View remediation snippet" : "View patch diff"}</summary>
                <pre className="max-h-72 overflow-auto border-t border-[var(--border)] p-3 text-[11px] leading-5 text-slate-700">{patch.kind === "snippet" ? patch.snippet || patch.diff : patch.diff}</pre>
              </details>
              {patch.kind === "snippet" ? <p className="mt-2 text-xs leading-5 text-slate-600">Guidance only. Adapt this snippet to the existing resource and validate it locally; direct commits are disabled.</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No remediation exports" body="This review has no saved remediation snippets. Automatic fix-commit generation is not supported." />
      )}
    </Card>
  );
}

function AuditPanel({ auditLog }: { auditLog: AuditLogEntry[] }) {
  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <History className="h-4 w-4 text-[#2563eb]" />
        <h2 className="text-sm font-semibold text-slate-950">Audit log</h2>
      </div>
      {auditLog.length ? (
        <div className="space-y-2">
          {auditLog.map((entry) => (
            <div key={entry.id} className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <p className="text-sm font-medium text-slate-900">{entry.action}</p>
              <p className="mt-1 text-xs text-slate-500">{entry.actor_email ?? "system"} / {formatDate(entry.created_at)}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No audit events" body="Worker, approval, GitHub, and patch events will be recorded here." />
      )}
    </Card>
  );
}

function confirmationTitle(pending: PendingConfirmation) {
  if (pending?.kind === "reject") return "Reject this PR comment draft?";
  if (pending?.kind === "post") return "Post the approved comment to GitHub?";
  if (pending?.kind === "commit_patch") return "Commit this patch to the PR branch?";
  return "Confirm action";
}

function confirmationDescription(pending: PendingConfirmation) {
  if (pending?.kind === "reject") return "This decision is persisted in the audit trail. The rejection reason will tell the change author what must be addressed.";
  if (pending?.kind === "post") return "This is an external write. TerraGate will post the generated review comment when live GitHub credentials and PR context are available.";
  if (pending?.kind === "commit_patch") return "This is an external write to the pull request branch. The approved diff will be committed only if the branch still matches the reviewed context.";
  return "Review the action before continuing.";
}

function confirmationLabel(pending: PendingConfirmation) {
  if (pending?.kind === "reject") return "Reject comment";
  if (pending?.kind === "post") return "Post comment";
  if (pending?.kind === "commit_patch") return "Commit patch";
  return "Continue";
}

function getRunTitle(run: RunDetail): string {
  if (run.github_pr_context?.title) {
    return `PR #${run.github_pr_context.pull_number ?? run.pull_number ?? ""}: ${run.github_pr_context.title}`;
  }
  if (run.pull_number) {
    return `PR #${run.pull_number}: Terraform risk review`;
  }
  return run.terraform_execution.source_filename || "Terraform plan review";
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function computeDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "not complete";
  const delta = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
  const seconds = Math.round(delta / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function downloadRemediation(patch: FixPatch) {
  const blob = new Blob([patch.kind === "snippet" ? patch.snippet || patch.diff : patch.diff], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${patch.id}.${patch.kind === "snippet" ? "tf" : "patch"}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function severityTextTone(severity: Severity | string): string {
  return (
    {
      critical: "text-red-800",
      high: "text-orange-800",
      medium: "text-amber-800",
      low: "text-sky-800",
      info: "text-slate-600"
    }[severity] ?? "text-slate-600"
  );
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatEvidenceJson(finding: Finding): string {
  const evidence = finding.evidence[0];
  return JSON.stringify(
    {
      resource: finding.resource_address,
      change: finding.change_actions,
      json_path: evidence?.json_path,
      observed: evidence?.observed_value,
      expected: evidence?.expected_value,
      rule_id: evidence?.rule_id
    },
    null,
    2
  );
}

function buildRunbookItems(selected: Finding | null, findings: Finding[], run: RunDetail | null): string[] {
  const selectedItems = selected?.runbook_checklist ?? [];
  const fallbackFindingItems = findings.flatMap((finding) => finding.runbook_checklist).slice(0, 6);
  const blastItems = run?.blast_radius.stateful_changes?.flatMap((change) => change.required_runbook ?? change.rollback_checklist ?? []) ?? [];
  const defaultItems = [
    "Backup and snapshot verified",
    "Maintenance window approved",
    "Rollback plan documented",
    "Owner signoff obtained",
    "Post-apply validation complete"
  ];
  return unique([...selectedItems, ...fallbackFindingItems, ...blastItems, ...defaultItems]).slice(0, 8);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
