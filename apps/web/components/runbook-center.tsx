"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Play,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  UserCheck
} from "lucide-react";
import { createDemoTerraformReview, getCurrentUser, getFindings, getRun, getRunbookProgress, getRuntimeCapabilities, listRuns, updateRunbookProgress } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { demoScenarioReviewOptions, presentRunListItem } from "@/lib/showcase";
import type { Finding, RunDetail, RunListItem, Severity } from "@/types/api";
import { AlertBanner, Badge, Button, Card, EmptyState, LoadingPanel, SeverityBadge } from "@/components/ui";

type RunbookStep = {
  id: string;
  text: string;
  source?: string;
  priority: "required" | "recommended";
};

type RunbookSection = {
  id: string;
  title: string;
  description: string;
  steps: RunbookStep[];
};

type GeneratedRunbook = {
  sections: RunbookSection[];
  markdown: string;
  requiredCount: number;
  sourceFindingCount: number;
};

const severityRank: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

const sectionIcons = {
  backup: ShieldCheck,
  rollback: RotateCcw,
  maintenance: Clock,
  signoff: UserCheck,
  validation: CheckCircle2
};

export function RunbookCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [run, setRun] = useState<RunDetail | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingRun, setLoadingRun] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [examplesAvailable, setExamplesAvailable] = useState(false);
  const [canEditProgress, setCanEditProgress] = useState(false);

  useEffect(() => {
    Promise.all([getRuntimeCapabilities(), getCurrentUser()])
      .then(([runtime, user]) => {
        setExamplesAvailable(runtime.public_demo || runtime.auth_provider === "dev");
        setCanEditProgress(user.role === "reviewer" || user.role === "platform-admin");
      })
      .catch(() => {
        setExamplesAvailable(false);
        setCanEditProgress(false);
      });
  }, []);

  useEffect(() => {
    listRuns()
      .then((items) => {
        const presented = items.map(presentRunListItem);
        setRuns(presented);
        const requestedRun = searchParams.get("run");
        const firstRun = presented.find((item) => item.id === requestedRun) ?? presented.find((item) => item.mode === "terraform_pr_review");
        if (firstRun) setSelectedRunId(firstRun.id);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingRuns(false));
  }, [searchParams]);

  useEffect(() => {
    if (!selectedRunId) {
      setRun(null);
      setFindings([]);
      return;
    }
    setLoadingRun(true);
    setError(null);
    Promise.all([getRun(selectedRunId), getFindings(selectedRunId), getRunbookProgress(selectedRunId)])
      .then(([runData, findingData, progressData]) => {
        setRun(runData);
        setFindings(findingData);
        setCheckedSteps(Object.fromEntries(progressData.map((entry) => [entry.step_id, entry.checked])));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingRun(false));
  }, [selectedRunId]);

  const runbook = useMemo(() => buildRunbook(run, findings), [run, findings]);
  const totalSteps = runbook.sections.reduce((total, section) => total + section.steps.length, 0);
  const completedSteps = runbook.sections.reduce((total, section) => {
    return total + section.steps.filter((step) => checkedSteps[step.id]).length;
  }, 0);

  async function refreshRuns() {
    setLoadingRuns(true);
    setError(null);
    try {
      const items = await listRuns();
      const presented = items.map(presentRunListItem);
      setRuns(presented);
      if (!selectedRunId && presented[0]) setSelectedRunId(presented[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh runs.");
    } finally {
      setLoadingRuns(false);
    }
  }

  async function launchRunbookSample() {
    setLaunching(true);
    setError(null);
    try {
      const result = await createDemoTerraformReview("destructive-prod", demoScenarioReviewOptions("destructive-prod"));
      router.push(`/runbooks?run=${result.run_id}`);
      setSelectedRunId(result.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch runbook sample.");
    } finally {
      setLaunching(false);
    }
  }

  function downloadRunbook() {
    const blob = new Blob([runbook.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `terragate-runbook-${run?.id ?? "review"}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function toggleStep(sectionId: string, stepId: string) {
    if (!run) return;
    if (!canEditProgress) {
      setError("Reviewer or platform administrator access is required to update runbook progress.");
      return;
    }
    const nextChecked = !checkedSteps[stepId];
    setCheckedSteps((current) => ({ ...current, [stepId]: nextChecked }));
    setProgressMessage(null);
    try {
      await updateRunbookProgress(run.id, stepId, nextChecked, sectionId);
      setProgressMessage(nextChecked ? "Checklist step saved." : "Checklist step reopened.");
    } catch (err) {
      setCheckedSteps((current) => ({ ...current, [stepId]: !nextChecked }));
      setError(err instanceof Error ? err.message : "Failed to save checklist progress.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-[#24324a] pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">Command mode</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">Generate Runbook</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Convert Terraform risk findings and blast-radius evidence into an operational deployment runbook with approval-ready checklists.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void refreshRuns()} disabled={loadingRuns}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          {examplesAvailable ? <Button onClick={() => void launchRunbookSample()} disabled={launching}>
            <Play className="h-4 w-4" /> {launching ? "Launching..." : "Run blast-radius sample"}
          </Button> : null}
        </div>
      </div>

      {error ? <AlertBanner tone="danger" title="Runbook unavailable" onDismiss={() => setError(null)}>{error}</AlertBanner> : null}
      {progressMessage ? <AlertBanner tone="success" onDismiss={() => setProgressMessage(null)}>{progressMessage}</AlertBanner> : null}

      <Card className="p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
          <div>
            <label className="text-sm font-medium text-slate-200" htmlFor="runbook-run">Review run</label>
            <select
              id="runbook-run"
              value={selectedRunId}
              onChange={(event) => setSelectedRunId(event.target.value)}
              className="mt-2 w-full rounded-md border border-[#31445f] bg-[#0a1424] px-3 py-2.5 text-sm text-white"
              disabled={loadingRuns || runs.length === 0}
            >
              {runs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} - {item.environment} - {item.risk_level}
                </option>
              ))}
            </select>
            {run ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <SeverityBadge severity={run.risk_level} />
                <Badge tone={run.approval_status === "approved" ? "success" : "warn"}>{run.approval_status}</Badge>
                <Badge tone="neutral">{run.policy_profile}</Badge>
                <Link href={`/runs/${run.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#43c6ac]">
                  Open run <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : null}
          </div>
          <div className="flex items-end">
            <Button variant="secondary" className="w-full" onClick={downloadRunbook} disabled={!run || loadingRun}>
              <Download className="h-4 w-4" /> Export Markdown
            </Button>
          </div>
        </div>
      </Card>

      {!run && (loadingRuns || loadingRun) ? <LoadingPanel label="Loading runbook evidence" /> : null}

      {!run && !loadingRuns && !loadingRun ? (
        <EmptyState title="No review runs yet" body={examplesAvailable ? "Launch a blast-radius example or create a Terraform review first." : "Create a Terraform review to generate an operational runbook."} />
      ) : null}

      {run ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Checklist steps" value={String(totalSteps)} detail={`${completedSteps} saved as complete`} />
            <MetricCard label="Required steps" value={String(runbook.requiredCount)} detail="Must complete before apply" tone="warn" />
            <MetricCard label="Source findings" value={String(runbook.sourceFindingCount)} detail="High-risk or manual-review inputs" />
            <MetricCard label="Stateful changes" value={String(run.blast_radius.stateful_changes?.length ?? 0)} detail={run.blast_radius.summary ?? "No stateful blast radius"} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_410px]">
            <div className="min-w-0 space-y-4">
              {runbook.sections.map((section) => (
                <RunbookSectionCard
                  key={section.id}
                  section={section}
                  checkedSteps={checkedSteps}
                  disabled={!canEditProgress}
                  onToggle={(stepId) => void toggleStep(section.id, stepId)}
                />
              ))}
            </div>

            <div className="min-w-0 space-y-4">
              <Card className="p-5">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-[#43c6ac]" />
                  <h2 className="text-lg font-semibold text-white">Runbook context</h2>
                </div>
                <div className="mt-4 space-y-3">
                  <SmallRow label="Run" value={run.id} mono />
                  <SmallRow label="Environment" value={run.environment} />
                  <SmallRow label="Risk" value={`${run.risk_level} (${run.risk_score})`} />
                  <SmallRow label="Policy" value={run.policy_profile} />
                  <SmallRow label="Generated" value={formatDate(run.completed_at ?? run.created_at)} />
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-[#6ea8fe]" />
                  <h2 className="text-lg font-semibold text-white">Evidence used</h2>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  The generated runbook is built from deterministic findings, finding-level runbook checklists, and stateful blast-radius metadata. It does not rely on free-form guessing.
                </p>
                <div className="mt-4 space-y-2">
                  {findings.slice(0, 5).map((finding) => (
                    <Link key={finding.id} href={`/runs/${run.id}`} className="block rounded-md border border-[#26364d] bg-[#091424] p-3 hover:border-[#3e587a]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">{finding.title}</span>
                        <SeverityBadge severity={finding.severity} />
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-slate-500">{finding.resource_address ?? "resource not mapped"}</p>
                    </Link>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-lg font-semibold text-white">Export preview</h2>
                <pre className="mt-4 max-h-[520px] overflow-auto rounded-md border border-[#25364d] bg-[#07101d] p-4 text-xs leading-6 text-slate-100">{runbook.markdown}</pre>
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function buildRunbook(run: RunDetail | null, findings: Finding[]): GeneratedRunbook {
  if (!run) {
    return { sections: [], markdown: "No review run selected.", requiredCount: 0, sourceFindingCount: 0 };
  }

  const sourceFindings = findings
    .filter((finding) => severityRank[finding.severity] >= severityRank.medium || finding.requires_human_review || finding.runbook_checklist.length > 0)
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
  const highRiskFindings = sourceFindings.filter((finding) => severityRank[finding.severity] >= severityRank.high);
  const statefulChanges = run.blast_radius.stateful_changes ?? [];
  const costDelta = Number(run.cost_estimate.monthly_delta ?? 0);
  const statefulResources = statefulChanges.map((item) => item.resource_address).filter(Boolean).join(", ");

  const backupSteps = uniqueSteps([
    ...statefulChanges.flatMap((item) => (item.required_runbook ?? []).filter((step) => /backup|snapshot|restore/i.test(step)).map((step) => fromText(step, item.resource_address ?? "blast radius", "required"))),
    ...sourceFindings.flatMap((finding) => finding.runbook_checklist.filter((step) => /backup|snapshot|restore/i.test(step)).map((step) => fromText(step, finding.resource_address ?? finding.title, "required"))),
    fromText(statefulChanges.length ? `Confirm the latest recoverable backup or snapshot exists for ${statefulResources}.` : "Confirm this plan has no stateful replacement or deletion requiring a backup.", "blast radius", statefulChanges.length ? "required" : "recommended"),
    fromText("Record current resource identifiers, endpoints, parameter groups, and encryption keys before apply.", "operator checklist", statefulChanges.length ? "required" : "recommended"),
    fromText("Verify restore permissions and backup retention are owned by the deployment team before the change window.", "operator checklist", statefulChanges.length ? "required" : "recommended")
  ], "backup");

  const rollbackSteps = uniqueSteps([
    ...statefulChanges.flatMap((item) => (item.rollback_checklist ?? []).map((step) => fromText(step, item.resource_address ?? "blast radius", "required"))),
    ...sourceFindings.flatMap((finding) => finding.runbook_checklist.filter((step) => /rollback|revert|restore|backout/i.test(step)).map((step) => fromText(step, finding.resource_address ?? finding.title, "required"))),
    fromText("Prepare a revert PR or Terraform rollback plan before applying the reviewed change.", "operator checklist", highRiskFindings.length ? "required" : "recommended"),
    fromText("Define the rollback trigger: failed health check, failed smoke test, data loss signal, or unacceptable error-rate increase.", "operator checklist", "required"),
    fromText("Keep the previous Terraform state, plan artifact, and deployment logs available for incident review.", "operator checklist", "recommended")
  ], "rollback");

  const maintenanceSteps = uniqueSteps([
    fromText(`Schedule the change window for the ${run.environment} environment with risk level ${run.risk_level}.`, "run metadata", run.environment === "prod" || run.risk_level === "critical" ? "required" : "recommended"),
    fromText("Notify service owners, on-call, and impacted teams before the window starts.", "operator checklist", "required"),
    fromText("Freeze unrelated infrastructure changes while this plan is being applied.", "operator checklist", run.environment === "prod" ? "required" : "recommended"),
    fromText(costDelta > 0 ? `Call out estimated cost delta of $${costDelta.toFixed(2)}/month before approval.` : "Confirm there is no material monthly cost increase in the selected review.", "cost estimate", costDelta > 0 ? "required" : "recommended"),
    fromText("Keep monitoring, logs, and cloud console access open during apply and validation.", "operator checklist", "recommended")
  ], "maintenance");

  const signoffSteps = uniqueSteps([
    fromText("Service owner confirms the resource list, business impact, and deployment timing.", "owner approval", "required"),
    fromText("Platform reviewer confirms policy exceptions, public exposure, and IAM scope are acceptable.", "platform approval", highRiskFindings.some((finding) => finding.category === "security" || finding.category === "governance") ? "required" : "recommended"),
    fromText("Data owner confirms backup, restore, and retention posture for stateful changes.", "data approval", statefulChanges.length ? "required" : "recommended"),
    fromText("Finance or platform owner approves material cost increases or missing cost attribution.", "cost approval", costDelta > 0 || sourceFindings.some((finding) => finding.category === "cost") ? "required" : "recommended"),
    fromText("Approver records decision and notes in TerraGate before any external GitHub action.", "approval gate", "required")
  ], "signoff");

  const validationSteps = uniqueSteps([
    ...sourceFindings.flatMap((finding) => finding.runbook_checklist.filter((step) => /valid|verify|monitor|check|test/i.test(step)).map((step) => fromText(step, finding.resource_address ?? finding.title, "required"))),
    fromText("Confirm Terraform apply completed with the reviewed resource actions only.", "post-apply", "required"),
    fromText("Run service smoke tests and dependency health checks immediately after apply.", "post-apply", "required"),
    fromText("Verify alarms, dashboards, and logs show no new error-rate, latency, or saturation regression.", "post-apply", "required"),
    fromText("Re-check the specific findings from this run and confirm expected controls are now in place.", "post-apply", "required"),
    fromText("Attach validation notes, timestamps, and owner initials to the change record.", "post-apply", "recommended")
  ], "validation");

  const sections: RunbookSection[] = [
    {
      id: "backup",
      title: "Backup checklist",
      description: "Pre-apply recovery requirements for stateful or high-risk infrastructure changes.",
      steps: backupSteps
    },
    {
      id: "rollback",
      title: "Rollback plan",
      description: "Decision points and actions required to safely back out the change.",
      steps: rollbackSteps
    },
    {
      id: "maintenance",
      title: "Maintenance window notes",
      description: "Coordination notes for scheduling, communication, and live monitoring.",
      steps: maintenanceSteps
    },
    {
      id: "signoff",
      title: "Owner signoff checklist",
      description: "Human approvals required before applying or posting external updates.",
      steps: signoffSteps
    },
    {
      id: "validation",
      title: "Post-apply validation steps",
      description: "Checks to prove the infrastructure change is healthy after apply.",
      steps: validationSteps
    }
  ];

  const markdown = buildRunbookMarkdown(run, sections, sourceFindings);
  return {
    sections,
    markdown,
    requiredCount: sections.reduce((total, section) => total + section.steps.filter((step) => step.priority === "required").length, 0),
    sourceFindingCount: sourceFindings.length
  };
}

function fromText(text: string, source: string, priority: RunbookStep["priority"]): Omit<RunbookStep, "id"> {
  return { text, source, priority };
}

function uniqueSteps(steps: Array<Omit<RunbookStep, "id">>, sectionId: string): RunbookStep[] {
  const seen = new Set<string>();
  const result: RunbookStep[] = [];
  steps.forEach((step) => {
    const key = step.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push({
      ...step,
      id: `${sectionId}-${result.length}-${key.slice(0, 34).replace(/[^a-z0-9]+/g, "-")}`
    });
  });
  return result;
}

function buildRunbookMarkdown(run: RunDetail, sections: RunbookSection[], sourceFindings: Finding[]): string {
  const lines = [
    "# TerraGate Operational Runbook",
    "",
    `Run ID: ${run.id}`,
    `Environment: ${run.environment}`,
    `Risk: ${run.risk_level} (${run.risk_score})`,
    `Policy profile: ${run.policy_profile}`,
    `Approval status: ${run.approval_status}`,
    `Generated: ${formatDate(run.completed_at ?? run.created_at)}`,
    "",
    "## Source findings",
    sourceFindings.length ? "" : "No high-risk or manual-review findings were available for this run."
  ];

  sourceFindings.slice(0, 12).forEach((finding) => {
    lines.push(`- ${finding.severity.toUpperCase()} - ${finding.title}`);
    lines.push(`  Resource: ${finding.resource_address ?? "n/a"}`);
    lines.push(`  Recommendation: ${finding.recommendation || "Review finding details in TerraGate."}`);
  });

  sections.forEach((section) => {
    lines.push("", `## ${section.title}`, section.description, "");
    section.steps.forEach((step) => {
      lines.push(`- [ ] ${step.priority === "required" ? "Required" : "Recommended"}: ${step.text}`);
      if (step.source) lines.push(`  Source: ${step.source}`);
    });
  });

  return lines.join("\n");
}

function RunbookSectionCard({
  section,
  checkedSteps,
  disabled,
  onToggle
}: {
  section: RunbookSection;
  checkedSteps: Record<string, boolean>;
  disabled: boolean;
  onToggle: (stepId: string) => void;
}) {
  const Icon = sectionIcons[section.id as keyof typeof sectionIcons] ?? FileText;
  const required = section.steps.filter((step) => step.priority === "required").length;
  return (
    <Card className="p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Icon className="h-5 w-5 text-[#43c6ac]" />
            <Badge tone={required ? "warn" : "neutral"}>{required} required</Badge>
            <Badge tone="info">{section.steps.length} steps</Badge>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">{section.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">{section.description}</p>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        {section.steps.map((step) => (
          <label key={step.id} className="flex gap-3 rounded-md border border-[#26364d] bg-[#091424] p-3 text-sm hover:border-[#3e587a]">
            <input
              type="checkbox"
              checked={Boolean(checkedSteps[step.id])}
              onChange={() => onToggle(step.id)}
              disabled={disabled}
              className="mt-1 h-4 w-4 shrink-0 rounded border-[#31445f] bg-[#07101d] accent-[#43c6ac]"
            />
            <span className="min-w-0">
              <span className={checkedSteps[step.id] ? "block text-slate-500 line-through" : "block text-slate-100"}>{step.text}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <Badge tone={step.priority === "required" ? "warn" : "neutral"}>{step.priority}</Badge>
                {step.source ? <span className="truncate">Source: {step.source}</span> : null}
              </span>
            </span>
          </label>
        ))}
      </div>
    </Card>
  );
}

function MetricCard({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "success" | "warn" | "danger" }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
          <p className="mt-2 text-xs text-slate-500">{detail}</p>
        </div>
        {tone !== "neutral" ? <Badge tone={tone}>{tone}</Badge> : null}
      </div>
    </Card>
  );
}

function SmallRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-[#26364d] bg-[#091424] px-3 py-2 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={mono ? "truncate font-mono text-xs text-slate-100" : "truncate text-slate-100"}>{value}</span>
    </div>
  );
}
