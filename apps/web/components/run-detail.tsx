"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
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
import {
  presentShowcaseAudit,
  presentShowcaseFindings,
  presentShowcasePatches,
  presentShowcaseReport,
  presentShowcaseRun
} from "@/lib/showcase";
import type { AuditLogEntry, AuthUser, Category, Finding, FixPatch, GitHubCommentResponse, Report, RunDetail, Severity } from "@/types/api";
import { AlertBanner, Badge, Button, Card, ConfirmDialog, EmptyState, LoadingPanel, SeverityBadge } from "@/components/ui";

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
      const presentedRun = presentShowcaseRun(runData);
      setRun(presentedRun);
      setFindings(presentShowcaseFindings(presentedRun, findingData));
      setReport(presentShowcaseReport(presentedRun, reportData));
      if (patchResult.status === "fulfilled") setFixPatches(presentShowcasePatches(presentedRun, patchResult.value));
      if (auditResult.status === "fulfilled") setAuditLog(presentShowcaseAudit(presentedRun, auditResult.value));
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
    return findings.find((finding) => finding.id === selectedFindingId) ?? findings[0] ?? null;
  }, [findings, selectedFindingId]);

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
        await approveRun(runId, notes);
        setFeedback({ tone: "success", text: "PR comment draft approved." });
      }
      if (action === "reject") {
        await rejectRun(runId, notes);
        setFeedback({ tone: "success", text: "PR comment draft rejected and the decision was added to the audit trail." });
      }
      if (action === "post") {
        const result: GitHubCommentResponse = await postGitHubComment(runId);
        setFeedback({ tone: "success", text: result.comment_url ? "Comment posted to GitHub." : result.message, href: result.comment_url ?? undefined });
      }
      await load(true);
    } catch (err) {
      setFeedback({ tone: "danger", text: err instanceof Error ? err.message : "Action failed." });
    } finally {
      setActionLoading(false);
    }
  }

  async function approvePatch(patchId: string) {
    setActionLoading(true);
    setFeedback(null);
    try {
      await approveFixPatch(runId, patchId);
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
      setFeedback({ tone: "success", text: result.commit_url ? "Patch committed to the pull request branch." : result.message, href: result.commit_url ?? undefined });
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
          <Link href="/overview" className="inline-flex min-h-10 items-center rounded-md border border-[#31445f] bg-[#142238] px-4 text-sm font-semibold text-slate-100">Back to overview</Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <AlertBanner tone="danger" title="Refresh failed" onDismiss={() => setError(null)}>{error}</AlertBanner> : null}
      {partialWarning ? <AlertBanner tone="warning" title="Some run data is unavailable" onDismiss={() => setPartialWarning(null)}>{partialWarning}</AlertBanner> : null}
      <RunHeader run={run} refreshing={refreshing} onRefresh={() => void load(true)} />

      <RiskCommandStrip run={run} findings={findings} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(760px,1fr)_300px_380px]">
        <div className="min-w-0 space-y-4">
          <FindingsCommandTable
            findings={filteredFindings}
            allFindings={findings}
            category={category}
            setCategory={setCategory}
            categoryCounts={categoryCounts}
            selectedFindingId={selectedFinding?.id ?? null}
            onSelect={(finding) => {
              setSelectedFindingId(finding.id);
              setInspectorTab("overview");
            }}
          />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
            <GraphProgressPanel run={run} />
            <CommentDraftPanel report={report} />
            <RunbookChecklistPanel items={runbookItems} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <PatchWorkflowPanel patches={fixPatches} actionLoading={actionLoading} canApprove={canReview} canCommit={canCommit} onApprove={approvePatch} onCommit={(patchId) => setPendingConfirmation({ kind: "commit_patch", patchId })} />
            <AuditPanel auditLog={auditLog} />
          </div>
        </div>

        <div className="space-y-4">
          <ApprovalRail
            run={run}
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

        <div className="min-w-0 xl:col-span-2 2xl:col-span-1">
          <FindingInspector finding={selectedFinding} tab={inspectorTab} setTab={setInspectorTab} />
        </div>
      </div>
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
    <header className="rounded-lg border border-[#21324a] bg-[#0b1525]/95 px-5 py-5 shadow-[0_20px_70px_rgba(0,0,0,0.24)]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">Runs / {run.id}</p>
          <div className="mt-3 flex min-w-0 items-center gap-3">
            <GitPullRequest className="h-6 w-6 shrink-0 text-slate-100" />
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-normal text-white md:text-3xl">{title}</h1>
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">{run.summary}</p>
          <div className="mt-5 grid gap-4 text-xs text-slate-400 sm:grid-cols-2 lg:grid-cols-6">
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
            Overall risk: {run.risk_level}
          </Badge>
          <Link
            href="/reviews/new"
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-[#31445f] bg-[#142238] px-3 text-sm font-semibold text-slate-100 transition hover:bg-[#1b2b45]"
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
    <div className="min-w-0 border-l border-[#25364d] pl-3 first:border-l-0 first:pl-0 sm:first:border-l sm:first:pl-3 lg:first:border-l-0 lg:first:pl-0">
      <p className="uppercase tracking-[0.14em] text-slate-500">{label}</p>
      {badgeTone ? (
        <div className="mt-1">
          <Badge tone={badgeTone}>{value}</Badge>
        </div>
      ) : (
        <p className="mt-1 truncate font-medium text-slate-100">{value}</p>
      )}
    </div>
  );
}

function CheckState({ run }: { run: RunDetail }) {
  const state = run.github_check?.state ?? "pending";
  const completed = state === "pass";
  return (
    <span className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[#31445f] bg-[#111d31] px-3 text-xs font-medium text-slate-200">
      <span className={cx("h-2.5 w-2.5 rounded-full", completed ? "bg-emerald-400" : state === "fail" ? "bg-red-400" : state === "warn" ? "bg-amber-300" : "bg-slate-500")} />
      GitHub check {run.github_check?.status ?? "not created"}
    </span>
  );
}

function RiskCommandStrip({ run, findings }: { run: RunDetail; findings: Finding[] }) {
  const criticalStateful = run.blast_radius.stateful_changes?.filter((item) => item.severity === "critical").length ?? 0;
  const blastResourceCount = run.blast_radius.stateful_changes?.length ?? 0;
  const blastResourceLabel = blastResourceCount === 0
    ? "No stateful destructive changes"
    : `${criticalStateful || blastResourceCount} ${criticalStateful ? "critical" : "stateful"} resources`;
  const rawArtifacts = run.artifacts.filter((artifact) => !artifact.redacted).length;
  const redactedArtifacts = run.artifacts.filter((artifact) => artifact.redacted).length;
  return (
    <section className="grid overflow-hidden rounded-lg border border-[#21324a] bg-[#0b1525] shadow-[0_18px_60px_rgba(0,0,0,0.22)] lg:grid-cols-5">
      <SummaryTile label="Risk score" icon={<ShieldAlert className="h-4 w-4" />}>
        <div className="flex items-end gap-1">
          <span className={cx("text-4xl font-semibold", severityTextTone(run.risk_level))}>{run.risk_score}</span>
          <span className="pb-1 text-lg text-slate-400">/100</span>
        </div>
        <p className={cx("mt-2 text-sm font-semibold capitalize", severityTextTone(run.risk_level))}>{run.risk_level} risk</p>
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

      <SummaryTile label="Cost delta (AWS)" icon={<DollarSign className="h-4 w-4" />}>
        <p className="text-3xl font-semibold text-amber-100">
          {formatMoney(run.cost_estimate.monthly_delta ?? 0)}
          <span className="ml-1 text-sm font-normal text-slate-400">/mo</span>
        </p>
        <p className="mt-2 text-sm text-amber-200">{formatMoney(run.cost_estimate.annual_delta ?? Number(run.cost_estimate.monthly_delta ?? 0) * 12)} /yr</p>
      </SummaryTile>

      <SummaryTile label="Blast radius" icon={<Database className="h-4 w-4" />}>
        <p className="text-base font-semibold text-red-100">{blastResourceLabel}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{run.blast_radius.summary ?? "No destructive stateful changes detected."}</p>
        <p className="mt-2 text-sm font-semibold capitalize text-red-200">{run.blast_radius.level ?? "low"}</p>
      </SummaryTile>

      <SummaryTile label="Data handling" icon={<LockKeyhole className="h-4 w-4" />}>
        <div className="space-y-2 text-sm">
          <DataState label="Raw artifact" value={`${rawArtifacts} stored`} tone="warn" />
          <DataState label="Redacted artifact" value={`${redactedArtifacts} used for analysis`} tone="success" />
          <DataState label="Findings" value={`${findings.length} persisted`} tone="info" />
        </div>
      </SummaryTile>
    </section>
  );
}

function SummaryTile({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-36 border-b border-[#21324a] p-4 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function DataState({ label, value, tone }: { label: string; value: string; tone: "success" | "warn" | "info" }) {
  const toneClass = tone === "success" ? "text-emerald-200" : tone === "warn" ? "text-amber-200" : "text-sky-200";
  return (
    <div className="flex items-start gap-2">
      <span className={cx("mt-1.5 h-2 w-2 rounded-full", tone === "success" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-300" : "bg-sky-300")} />
      <span>
        <span className="block text-xs text-slate-400">{label}</span>
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
      <div className="flex flex-col gap-3 border-b border-[#24324a] px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Findings ({allFindings.length})</p>
          <h2 className="mt-1 text-base font-semibold text-white">Evidence-backed infrastructure risks</h2>
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
                  ? "border-[#43c6ac] bg-[#43c6ac]/14 text-[#bdf4e9]"
                  : "border-[#31445f] bg-[#0b1525] text-slate-400 hover:bg-[#13213a] hover:text-slate-100"
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
          <div className="divide-y divide-[#1d2a3f] md:hidden">
            {findings.map((finding) => {
              const selected = finding.id === selectedFindingId;
              return (
                <button
                  key={finding.id}
                  type="button"
                  onClick={() => onSelect(finding)}
                  aria-pressed={selected}
                  className={cx("block w-full px-4 py-4 text-left transition", selected ? "bg-[#12313d]" : "hover:bg-[#101d31]")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{finding.title}</p>
                      <p className="mt-2 truncate font-mono text-xs text-slate-400">{finding.resource_address ?? "resource not mapped"}</p>
                    </div>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <Badge tone="neutral">{finding.category}</Badge>
                    <span>{Math.round(finding.confidence * 100)}% confidence</span>
                    {finding.requires_human_review ? <Badge tone="warn">human review</Badge> : null}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="border-b border-[#24324a] bg-[#101b2d] text-[11px] uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3"></th>
                <th className="px-3 py-3">Severity</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3">Resource</th>
                <th className="px-3 py-3">File</th>
                <th className="px-3 py-3">Confidence</th>
                <th className="px-3 py-3">Source</th>
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
                      "cursor-pointer border-b border-[#1d2a3f] transition last:border-0",
                      selected ? "bg-[#12313d] outline outline-1 outline-[#43c6ac]" : "hover:bg-[#101d31]"
                    )}
                  >
                    <td className="px-4 py-3">
                      <span className={cx("flex h-4 w-4 items-center justify-center rounded border", selected ? "border-[#43c6ac] bg-[#43c6ac] text-[#07111f]" : "border-[#40536f]")}>
                        {selected ? <CheckCircle2 className="h-3 w-3" /> : null}
                      </span>
                    </td>
                    <td className="px-3 py-3"><SeverityBadge severity={finding.severity} /></td>
                    <td className="px-3 py-3 capitalize text-slate-300">{finding.category}</td>
                    <td className="px-3 py-3 font-medium text-white">{finding.title}</td>
                    <td className="max-w-44 truncate px-3 py-3 font-mono text-xs text-slate-300">{finding.resource_address ?? "n/a"}</td>
                    <td className="max-w-36 truncate px-3 py-3 font-mono text-xs text-slate-400">{finding.pr_file_path ?? "not mapped"}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-9 text-xs text-slate-300">{Math.round(finding.confidence * 100)}%</span>
                        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[#21324a]">
                          <span className="block h-full rounded-full bg-[#43c6ac]" style={{ width: `${Math.round(finding.confidence * 100)}%` }} />
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400">{finding.source.replaceAll("_", " ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}
      <div className="flex items-center justify-between border-t border-[#24324a] px-4 py-3 text-xs text-slate-500">
        <span>1-{findings.length} of {findings.length} results</span>
        <span>{allFindings.filter((finding) => finding.requires_human_review).length} require human review</span>
      </div>
    </Card>
  );
}

function ApprovalRail({
  run,
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Approval status</p>
          <h2 className="mt-2 text-lg font-semibold text-amber-100">{run.approval_status === "approved" ? "Approved" : run.approval_status === "rejected" ? "Rejected" : "Approval required"}</h2>
        </div>
        <Badge tone={run.approval_status === "approved" ? "success" : run.approval_status === "rejected" ? "danger" : "warn"}>{run.approval_status}</Badge>
      </div>
      <p className="mt-2 text-sm leading-5 text-slate-400">
        {run.approval_status === "approved"
          ? "Approved runs can post the generated comment or commit approved fixes."
          : run.approval_status === "rejected"
            ? "This review has been rejected. Record new approval notes before re-approving."
            : "A human must approve before posting to GitHub or committing suggested fixes."}
      </p>
      <div className="mt-4 grid gap-2">
        <Button onClick={onApprove} disabled={actionLoading || !canReview || run.approval_status === "approved"} className="w-full">
          <CheckCircle2 className="h-4 w-4" /> {run.approval_status === "approved" ? "Approved" : "Approve comment"}
        </Button>
        <Button variant="secondary" onClick={onReject} disabled={actionLoading || !canReview || run.approval_status === "rejected"} className="w-full">
          <XCircle className="h-4 w-4" /> {run.approval_status === "rejected" ? "Rejected" : "Request changes"}
        </Button>
        <Button variant="secondary" onClick={onPost} disabled={actionLoading || !canReview || run.approval_status !== "approved"} className="w-full">
          <GitPullRequest className="h-4 w-4" /> Post to GitHub
        </Button>
      </div>
      {!canReview ? <p className="mt-3 text-xs leading-5 text-amber-200">Reviewer or platform administrator access is required for decisions and GitHub comments.</p> : null}
      <label className="mt-5 block">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Approval notes</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Add notes for approval..."
          className="mt-2 min-h-24 w-full resize-y rounded-md border border-[#31445f] bg-[#09111f] p-3 text-sm text-white placeholder:text-slate-500"
        />
      </label>
      {feedback ? <div className="mt-4"><AlertBanner tone={feedback.tone}>{feedback.text}{feedback.href ? <a href={feedback.href} target="_blank" rel="noreferrer" className="ml-1 font-semibold underline underline-offset-2">Open in GitHub</a> : null}</AlertBanner></div> : null}
    </Card>
  );
}

function RunMetadataPanel({ run }: { run: RunDetail }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Run metadata</p>
      <div className="mt-3 space-y-2">
        <RailMetric label="Run ID" value={run.id} mono />
        <RailMetric label="Policy version" value={run.policy_profile} />
        <RailMetric label="Artifacts" value={String(run.artifacts.length)} />
        <RailMetric label="Graph progress" value={`${run.graph_progress.length} nodes`} />
        <RailMetric label="Trace ID" value={run.trace_id ?? "LangSmith disabled"} mono />
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">GitHub context</p>
        <p className="mt-3 text-sm leading-5 text-slate-400">No GitHub PR context was attached to this run.</p>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <GitPullRequest className="h-4 w-4 text-[#6ea8fe]" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">GitHub PR context</p>
      </div>
      <p className="mt-3 text-sm font-semibold text-white">{context?.title ?? `${run.repo_owner}/${run.repo_name}#${run.pull_number}`}</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">{context?.message ?? "Repository metadata attached to this review."}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <RailMetric label="Source" value={context?.mock ? "simulated / unavailable" : context ? "live GitHub" : "manual"} />
        <RailMetric label="Files" value={String(context?.changed_files_count ?? 0)} />
        <RailMetric label="Terraform" value={String(context?.terraform_files.length ?? 0)} />
        <RailMetric label="Diff" value={`+${context?.additions ?? 0} / -${context?.deletions ?? 0}`} />
      </div>
      {context?.html_url ? (
        <a href={context.html_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#43c6ac]">
          Open pull request <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </Card>
  );
}

function RailMetric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-[#26364d] bg-[#091424] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={cx("mt-1 truncate text-xs font-medium text-slate-100", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function FindingInspector({ finding, tab, setTab }: { finding: Finding | null; tab: InspectorTab; setTab: (tab: InspectorTab) => void }) {
  if (!finding) {
    return (
      <Card className="min-h-[540px] p-5">
        <EmptyState title="No finding selected" body="Select a finding to inspect evidence, impact, remediation, and runbook steps." />
      </Card>
    );
  }

  const evidence = finding.evidence[0];
  return (
    <aside className="rounded-lg border border-[#24324a] bg-[#081120] shadow-[0_20px_70px_rgba(0,0,0,0.26)] 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-2rem)] 2xl:overflow-y-auto">
      <div className="border-b border-[#24324a] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className={cx("h-5 w-5", severityTextTone(finding.severity))} />
              <SeverityBadge severity={finding.severity} />
            </div>
            <h2 className="mt-4 text-xl font-semibold text-white">{finding.title}</h2>
            <p className="mt-1 text-sm capitalize text-slate-400">{finding.category} / {finding.severity}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-4 border-b border-[#24324a] text-xs">
          {(["overview", "evidence", "remediation", "runbook"] as InspectorTab[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={cx(
                "border-b px-1 pb-3 text-center capitalize transition",
                tab === item ? "border-[#43c6ac] text-[#bdf4e9]" : "border-transparent text-slate-500 hover:text-slate-200"
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
              <p className="font-mono text-sm text-slate-200">{finding.resource_address ?? "resource not mapped"}</p>
              <p className="mt-2 text-xs text-slate-500">{finding.resource_type ?? "unknown resource type"} / {finding.provider ?? "unknown provider"}</p>
            </InspectorBlock>
            <InspectorBlock title="File and line">
              {finding.pr_file_url ? (
                <a href={finding.pr_file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-sm text-[#9eeadf] hover:text-white">
                  {finding.pr_file_path}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <p className="font-mono text-sm text-slate-200">{finding.pr_file_path ?? "not mapped to a PR file"}</p>
              )}
            </InspectorBlock>
            <InspectorBlock title="Impact" body={finding.impact || "This finding is tied to deployable Terraform evidence and should be reviewed before apply."} />
            <InspectorBlock title="Recommendation" body={finding.recommendation} />
          </>
        ) : null}

        {tab === "evidence" ? (
          <>
            <InspectorBlock title="Evidence excerpt">
              <pre className="max-h-72 overflow-auto rounded-md border border-[#25364d] bg-[#07101d] p-3 text-xs leading-6 text-slate-200">{formatEvidenceJson(finding)}</pre>
            </InspectorBlock>
            <InspectorBlock title="JSON path">
              <p className="font-mono text-xs text-slate-200">{evidence?.json_path ?? "n/a"}</p>
            </InspectorBlock>
            <InspectorBlock title="Observed value">
              <p className="break-words rounded-md bg-[#07101d] p-3 font-mono text-xs text-slate-200">{stringifyValue(evidence?.observed_value ?? "n/a")}</p>
            </InspectorBlock>
            <InspectorBlock title="Expected value">
              <p className="break-words rounded-md bg-[#07101d] p-3 font-mono text-xs text-slate-200">{stringifyValue(evidence?.expected_value ?? "n/a")}</p>
            </InspectorBlock>
            <InspectorBlock title="Rule" body={`${evidence?.rule_id ?? "n/a"} - ${evidence?.explanation ?? ""}`} />
          </>
        ) : null}

        {tab === "remediation" ? (
          <>
            <InspectorBlock title="Recommendation" body={finding.recommendation} />
            {finding.remediation ? (
              <>
                <InspectorBlock title="Suggested change">
                  <p className="text-sm leading-6 text-slate-400">{finding.remediation.explanation}</p>
                  <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-[#25364d] bg-[#07101d] p-3 text-xs leading-6 text-slate-100">{finding.remediation.snippet}</pre>
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
                <ul className="space-y-2 text-sm text-slate-200">
                  {finding.runbook_checklist.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#43c6ac]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">No runbook steps were generated for this finding.</p>
              )}
            </InspectorBlock>
            <InspectorBlock title="Compliance" body={finding.compliance_refs.join(", ") || "Internal TerraGate policy"} />
            <InspectorBlock title="Confidence">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-[#43c6ac]">{Math.round(finding.confidence * 100)}%</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#21324a]">
                  <span className="block h-full rounded-full bg-[#43c6ac]" style={{ width: `${Math.round(finding.confidence * 100)}%` }} />
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
    <section className="border-b border-[#1f2d42] pb-4 last:border-b-0 last:pb-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</h3>
      {body ? <p className="mt-3 text-sm leading-6 text-slate-300">{body}</p> : null}
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
          <Activity className="h-4 w-4 text-[#43c6ac]" />
          <h2 className="text-sm font-semibold text-white">Graph progress</h2>
        </div>
        <Badge tone="neutral">{steps.length} nodes</Badge>
      </div>
      <div className="mt-7 flex items-start gap-1 overflow-x-auto pb-1">
        {steps.map((step, index) => {
          const complete = step.status === "completed" || index < steps.length - 1;
          return (
            <div key={`${step.node}-${step.timestamp}-${index}`} className="flex min-w-[70px] flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span className={cx("h-px flex-1", index === 0 ? "bg-transparent" : "bg-[#26435e]")} />
                <span className={cx("flex h-5 w-5 items-center justify-center rounded-full border", complete ? "border-[#43c6ac] bg-[#12313d] text-[#43c6ac]" : "border-slate-500 text-slate-500")}>
                  {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3 w-3" />}
                </span>
                <span className={cx("h-px flex-1", index === steps.length - 1 ? "bg-transparent" : "bg-[#26435e]")} />
              </div>
              <p className="mt-2 truncate text-center text-[10px] font-medium text-slate-300">{graphNodeLabels[step.node] ?? step.node.replaceAll("_", " ")}</p>
              <p className="mt-1 text-center text-[10px] text-slate-500">{shortDuration(index + 1)}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-slate-500">Completed {Math.max(0, steps.length - 1)} / {steps.length} / {computeDuration(run.created_at, run.completed_at)}</p>
    </Card>
  );
}

function CommentDraftPanel({ report }: { report: Report }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-[#6ea8fe]" />
          <h2 className="text-sm font-semibold text-white">PR comment draft</h2>
        </div>
        <Badge tone="neutral">Preview</Badge>
      </div>
      {report.pr_comment_draft ? (
        <pre className="mt-4 max-h-52 overflow-auto rounded-md border border-[#25364d] bg-[#07101d] p-3 text-[11px] leading-5 text-slate-100">{report.pr_comment_draft}</pre>
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
        <h2 className="text-sm font-semibold text-white">Runbook checklist</h2>
        <Badge tone="neutral">{items.length}</Badge>
      </div>
      {items.length ? (
        <ul className="mt-4 space-y-3">
          {items.slice(0, 6).map((item) => (
            <li key={item} className="flex gap-2 text-xs leading-5 text-slate-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-[#43c6ac]" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm leading-5 text-slate-400">No runbook checklist items were generated for the selected finding.</p>
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
        <FileDiff className="h-4 w-4 text-[#43c6ac]" />
        <h2 className="text-sm font-semibold text-white">Suggested fix workflow</h2>
      </div>
      {patches.length ? (
        <div className="space-y-3">
          {patches.slice(0, 3).map((patch) => (
            <div key={patch.id} className="rounded-md border border-[#26364d] bg-[#091424] p-3">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                <div className="min-w-0">
                  <Badge tone={patch.status === "approved" || patch.status === "committed" ? "success" : "neutral"}>{patch.status}</Badge>
                  <p className="mt-2 text-sm font-semibold text-white">{patch.summary}</p>
                  <p className="mt-1 truncate font-mono text-xs text-slate-500">{patch.pr_file_path ?? "file not mapped"}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" className="min-h-8 px-3 text-xs" disabled={actionLoading || !canApprove || patch.status === "approved" || patch.status === "committed"} onClick={() => void onApprove(patch.id)}>
                    Approve
                  </Button>
                  <Button className="min-h-8 px-3 text-xs" disabled={actionLoading || !canCommit || patch.status !== "approved"} onClick={() => void onCommit(patch.id)}>
                    Commit
                  </Button>
                </div>
              </div>
              <details className="mt-3 rounded-md border border-[#25364d] bg-[#07101d]">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-300">View patch diff</summary>
                <pre className="max-h-72 overflow-auto border-t border-[#25364d] p-3 text-[11px] leading-5 text-slate-200">{patch.diff}</pre>
              </details>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No suggested patches" body="Patch drafts appear here when findings include enough PR context." />
      )}
    </Card>
  );
}

function AuditPanel({ auditLog }: { auditLog: AuditLogEntry[] }) {
  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <History className="h-4 w-4 text-[#6ea8fe]" />
        <h2 className="text-sm font-semibold text-white">Audit log</h2>
      </div>
      {auditLog.length ? (
        <div className="space-y-2">
          {auditLog.slice(0, 8).map((entry) => (
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
  );
}

function confirmationTitle(pending: PendingConfirmation) {
  if (pending?.kind === "reject") return "Request changes on this review?";
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
  if (pending?.kind === "reject") return "Request changes";
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
  return "Terraform PR risk review";
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

function shortDuration(index: number): string {
  return `${Math.max(1, index)}.${index % 10}s`;
}

function severityTextTone(severity: Severity | string): string {
  return (
    {
      critical: "text-red-200",
      high: "text-orange-200",
      medium: "text-amber-100",
      low: "text-sky-200",
      info: "text-slate-300"
    }[severity] ?? "text-slate-300"
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
