"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ClipboardCheck, Download, ExternalLink, FileSearch, Play, RefreshCcw, ShieldAlert, TriangleAlert } from "lucide-react";
import { createDemoTerraformReview, getFindings, getRun, getRuntimeCapabilities, listRuns } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { demoScenarioReviewOptions, presentRunListItem } from "@/lib/showcase";
import type { Finding, RunDetail, RunListItem, Severity } from "@/types/api";
import { AlertBanner, Badge, Button, Card, EmptyState, LoadingPanel, SeverityBadge } from "@/components/ui";

type ControlStatus = "pass" | "fail" | "needs_review";

type ComplianceControl = {
  id: string;
  title: string;
  framework: string;
  refs: string[];
  intent: string;
};

type ControlResult = ComplianceControl & {
  status: ControlStatus;
  findings: Finding[];
  severity: Severity | "none";
};

const controls: ComplianceControl[] = [
  {
    id: "network-boundary",
    title: "Restrict public administrative ingress",
    framework: "CIS AWS / NIST",
    refs: ["CIS AWS Foundations 5.2", "NIST AC-4", "NIST SC-7"],
    intent: "Internet-facing administrative ports should be restricted to approved CIDRs or private access paths."
  },
  {
    id: "database-exposure",
    title: "Prevent public database exposure",
    framework: "CIS AWS / NIST",
    refs: ["CIS AWS Foundations 2.3.3", "NIST SC-7"],
    intent: "Databases should not be reachable from public networks unless there is a documented exception."
  },
  {
    id: "encryption-at-rest",
    title: "Require encryption at rest",
    framework: "CIS AWS / NIST",
    refs: ["CIS AWS Foundations 2.1", "NIST SC-28"],
    intent: "Storage services should use managed or customer-managed encryption controls where visible in plan evidence."
  },
  {
    id: "least-privilege",
    title: "Avoid wildcard IAM permissions",
    framework: "CIS AWS / NIST",
    refs: ["CIS AWS Foundations 1.16", "NIST AC-6"],
    intent: "IAM policies should scope actions and resources to the minimum access required."
  },
  {
    id: "resilience",
    title: "Protect backup and recovery controls",
    framework: "NIST",
    refs: ["NIST CP-9", "NIST CP-10"],
    intent: "Stateful production resources should have backup retention, deletion protection, and rollback planning."
  },
  {
    id: "asset-governance",
    title: "Maintain ownership and inventory tags",
    framework: "NIST",
    refs: ["NIST CM-8", "NIST PM-5"],
    intent: "Required tags should support ownership, service inventory, cost attribution, and incident routing."
  },
  {
    id: "internal-policy",
    title: "Meet selected TerraGate policy pack",
    framework: "Internal",
    refs: ["Internal TerraGate Policy"],
    intent: "Plan changes should satisfy configured policy-pack checks or carry explicit reviewer approval."
  }
];

const severityRank: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  none: 0
};

export function ComplianceCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [run, setRun] = useState<RunDetail | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingRun, setLoadingRun] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examplesAvailable, setExamplesAvailable] = useState(false);

  useEffect(() => {
    getRuntimeCapabilities()
      .then((runtime) => setExamplesAvailable(runtime.public_demo || runtime.auth_provider === "dev"))
      .catch(() => setExamplesAvailable(false));
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
    Promise.all([getRun(selectedRunId), getFindings(selectedRunId)])
      .then(([runData, findingData]) => {
        setRun(runData);
        setFindings(findingData);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingRun(false));
  }, [selectedRunId]);

  const controlResults = useMemo(() => buildControlResults(findings), [findings]);
  const summary = useMemo(() => summarizeControls(controlResults), [controlResults]);
  const exportMarkdown = useMemo(() => buildExportMarkdown(run, controlResults, summary), [run, controlResults, summary]);

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

  async function launchComplianceSample() {
    setLaunching(true);
    setError(null);
    try {
      const result = await createDemoTerraformReview("risky-security", demoScenarioReviewOptions("risky-security"));
      router.push(`/compliance?run=${result.run_id}`);
      setSelectedRunId(result.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch compliance sample.");
    } finally {
      setLaunching(false);
    }
  }

  function downloadSummary() {
    const blob = new Blob([exportMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `terragate-compliance-${run?.id ?? "summary"}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-[#24324a] pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">Command mode</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">Compliance Check</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            CIS/NIST-style checklist mapped to Terraform review findings, resource evidence, policy profile, and approval state.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void refreshRuns()} disabled={loadingRuns}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          {examplesAvailable ? <Button onClick={() => void launchComplianceSample()} disabled={launching}>
            <Play className="h-4 w-4" /> {launching ? "Launching..." : "Run sample check"}
          </Button> : null}
        </div>
      </div>

      {error ? <AlertBanner tone="danger" title="Compliance data unavailable" onDismiss={() => setError(null)}>{error}</AlertBanner> : null}

      <Card className="p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <label className="text-sm font-medium text-slate-200" htmlFor="compliance-run">Review run</label>
            <select
              id="compliance-run"
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
            <Button variant="secondary" className="w-full" onClick={downloadSummary} disabled={!run || loadingRun}>
              <Download className="h-4 w-4" /> Export summary
            </Button>
          </div>
        </div>
      </Card>

      {!run && (loadingRuns || loadingRun) ? <LoadingPanel label="Loading compliance evidence" /> : null}

      {!run && !loadingRuns && !loadingRun ? (
        <EmptyState title="No review runs yet" body={examplesAvailable ? "Launch an example check or create a Terraform review first." : "Create a Terraform review to map its findings to compliance controls."} />
      ) : null}

      {run ? (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Controls" value={String(controlResults.length)} detail={`${summary.totalFindings} mapped findings`} />
            <MetricCard label="Failing" value={String(summary.fail)} detail="High or critical evidence" tone="danger" />
            <MetricCard label="Needs review" value={String(summary.needsReview)} detail="Medium/low evidence or manual review" tone="warn" />
            <MetricCard label="Passing" value={String(summary.pass)} detail="No mapped finding" tone="success" />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
            <div className="min-w-0 space-y-4">
              {controlResults.map((control) => (
                <ControlCard key={control.id} control={control} />
              ))}
            </div>
            <div className="min-w-0 space-y-4">
              <Card className="p-5">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-[#43c6ac]" />
                  <h2 className="text-lg font-semibold text-white">Checklist summary</h2>
                </div>
                <div className="mt-4 space-y-3">
                  <SmallRow label="Run" value={run.id} mono />
                  <SmallRow label="Environment" value={run.environment} />
                  <SmallRow label="Policy profile" value={run.policy_profile} />
                  <SmallRow label="Approval" value={run.approval_status.replaceAll("_", " ")} />
                  <SmallRow label="Reviewed" value={formatDate(run.completed_at)} />
                </div>
              </Card>
              <Card className="p-5">
                <div className="flex items-center gap-2">
                  <FileSearch className="h-5 w-5 text-[#6ea8fe]" />
                  <h2 className="text-lg font-semibold text-white">Evidence coverage</h2>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  Each failing or review-needed control links back to deterministic findings with resource address, JSON path evidence, observed value, and remediation guidance.
                </p>
                <div className="mt-4 space-y-2">
                  {Object.entries(summary.frameworkCounts).map(([framework, count]) => (
                    <SmallRow key={framework} label={framework} value={`${count} refs`} />
                  ))}
                </div>
              </Card>
              <Card className="p-5">
                <h2 className="text-lg font-semibold text-white">Export preview</h2>
                <pre className="mt-4 max-h-96 overflow-auto rounded-md border border-[#25364d] bg-[#07101d] p-4 text-xs leading-6 text-slate-100">{exportMarkdown}</pre>
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function buildControlResults(findings: Finding[]): ControlResult[] {
  return controls.map((control) => {
    const matched = findings.filter((finding) => finding.compliance_refs.some((ref) => control.refs.includes(ref)));
    const severity = maxSeverity(matched);
    const hasHumanReview = matched.some((finding) => finding.requires_human_review);
    const status: ControlStatus = severityRank[severity] >= severityRank.high ? "fail" : matched.length > 0 || hasHumanReview ? "needs_review" : "pass";
    return { ...control, status, findings: matched, severity };
  });
}

function summarizeControls(results: ControlResult[]) {
  const frameworkCounts = results.reduce<Record<string, number>>((acc, control) => {
    control.refs.forEach((ref) => {
      const framework = ref.startsWith("CIS") ? "CIS AWS" : ref.startsWith("NIST") ? "NIST 800-53" : "Internal";
      acc[framework] = (acc[framework] ?? 0) + 1;
    });
    return acc;
  }, {});
  return {
    pass: results.filter((control) => control.status === "pass").length,
    fail: results.filter((control) => control.status === "fail").length,
    needsReview: results.filter((control) => control.status === "needs_review").length,
    totalFindings: results.reduce((total, control) => total + control.findings.length, 0),
    frameworkCounts
  };
}

function maxSeverity(findings: Finding[]): Severity | "none" {
  return findings.reduce<Severity | "none">((highest, finding) => {
    return severityRank[finding.severity] > severityRank[highest] ? finding.severity : highest;
  }, "none");
}

function statusTone(status: ControlStatus): "success" | "warn" | "danger" {
  if (status === "pass") return "success";
  if (status === "fail") return "danger";
  return "warn";
}

function statusLabel(status: ControlStatus): string {
  if (status === "pass") return "Pass";
  if (status === "fail") return "Fail";
  return "Needs review";
}

function buildExportMarkdown(run: RunDetail | null, controls: ControlResult[], summary: ReturnType<typeof summarizeControls>): string {
  if (!run) return "No run selected.";
  const lines = [
    "# TerraGate Compliance Summary",
    "",
    `Run ID: ${run.id}`,
    `Environment: ${run.environment}`,
    `Policy profile: ${run.policy_profile}`,
    `Approval status: ${run.approval_status}`,
    `Completed: ${formatDate(run.completed_at)}`,
    "",
    `Controls: ${controls.length}`,
    `Pass: ${summary.pass}`,
    `Fail: ${summary.fail}`,
    `Needs review: ${summary.needsReview}`,
    "",
    "## Checklist"
  ];
  controls.forEach((control) => {
    lines.push("", `### ${statusLabel(control.status)} - ${control.title}`);
    lines.push(`Refs: ${control.refs.join(", ")}`);
    lines.push(`Intent: ${control.intent}`);
    if (control.findings.length === 0) {
      lines.push("Evidence: No mapped finding in this Terraform review.");
    } else {
      control.findings.slice(0, 5).forEach((finding) => {
        const evidence = finding.evidence[0];
        lines.push(`- ${finding.severity.toUpperCase()} ${finding.title}`);
        lines.push(`  Resource: ${finding.resource_address ?? "n/a"}`);
        lines.push(`  Evidence: ${evidence?.json_path ?? "n/a"} ${stringValue(evidence?.observed_value)}`);
        lines.push(`  Recommendation: ${finding.recommendation || "Review finding details."}`);
      });
    }
  });
  return lines.join("\n");
}

function ControlCard({ control }: { control: ControlResult }) {
  const Icon = control.status === "pass" ? CheckCircle2 : control.status === "fail" ? ShieldAlert : TriangleAlert;
  return (
    <Card className="p-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Icon className={`h-5 w-5 ${control.status === "pass" ? "text-[#43c6ac]" : control.status === "fail" ? "text-red-300" : "text-amber-300"}`} />
            <Badge tone={statusTone(control.status)}>{statusLabel(control.status)}</Badge>
            <Badge tone="neutral">{control.framework}</Badge>
            {control.severity !== "none" ? <SeverityBadge severity={control.severity} /> : null}
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">{control.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">{control.intent}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {control.refs.map((ref) => (
              <span key={ref} className="rounded-full border border-[#31445f] bg-[#091424] px-2.5 py-1 text-xs text-slate-300">{ref}</span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-3xl font-semibold text-white">{control.findings.length}</p>
          <p className="text-xs text-slate-500">mapped findings</p>
        </div>
      </div>
      {control.findings.length ? (
        <div className="mt-5 space-y-3">
          {control.findings.map((finding) => (
            <div key={finding.id} className="min-w-0 overflow-hidden rounded-md border border-[#26364d] bg-[#091424] p-4">
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                <div className="min-w-0">
                  <SeverityBadge severity={finding.severity} />
                  <p className="mt-2 text-sm font-semibold text-white">{finding.title}</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-500">{finding.resource_address ?? "resource not mapped"}</p>
                </div>
                <Badge tone={finding.requires_human_review ? "warn" : "info"}>{finding.requires_human_review ? "Human review" : finding.source}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">{finding.recommendation}</p>
              {finding.evidence[0] ? (
                <div className="mt-3 min-w-0 rounded-md border border-[#20314a] bg-[#07101d] p-3 text-xs">
                  <p className="break-all font-mono text-slate-300">{finding.evidence[0].json_path}</p>
                  <p className="mt-1 break-words text-slate-500">Observed: {stringValue(finding.evidence[0].observed_value)}</p>
                  {finding.evidence[0].expected_value !== null ? <p className="mt-1 break-words text-slate-500">Expected: {stringValue(finding.evidence[0].expected_value)}</p> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-md border border-[#26364d] bg-[#091424] p-3 text-sm text-slate-400">No mapped findings for this control in the selected review.</p>
      )}
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

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "n/a";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
