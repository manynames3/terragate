import type { AuditLogEntry, Category, Finding, FixPatch, GitHubPRContext, Report, RunDetail, RunListItem, Severity } from "@/types/api";

export const SHOWCASE_STORAGE_KEY = "terragate.showcase_run_id";

type DemoSample = "safe" | "risky-security" | "risky-cost" | "destructive-prod";

type ScenarioFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string;
};

type ScenarioCostLine = {
  resource_address: string;
  resource_type: string;
  description: string;
  monthly_delta: number;
  confidence: number;
};

type DemoScenario = {
  sample: DemoSample;
  title: string;
  repoOwner: string;
  repoName: string;
  pullNumber: number;
  environment: string;
  cloudProvider: string;
  policyProfile: string;
  author: string;
  headRef: string;
  labels: string[];
  reviewers: string[];
  files: ScenarioFile[];
  resourceFileHints: Array<{ match: string; file: string }>;
  topRisks: Array<{ severity: Severity; title: string; resource: string; recommendation: string }>;
  fallbackCost: {
    monthly_delta: number;
    threshold: number;
    message: string;
    line_items: ScenarioCostLine[];
  };
  fallbackBlast: NonNullable<RunDetail["blast_radius"]>;
  patch: {
    id: string;
    finding_id: string | null;
    file: string;
    summary: string;
    diff: string;
  } | null;
  auditNotes: Array<{ action: string; note: string }>;
};

const DEMO_SCENARIOS: Record<DemoSample, DemoScenario> = {
  "destructive-prod": {
    sample: "destructive-prod",
    title: "production database replacement",
    repoOwner: "acme-infra",
    repoName: "terraform-aws",
    pullNumber: 128,
    environment: "prod",
    cloudProvider: "aws",
    policyProfile: "restricted",
    author: "platform-admin",
    headRef: "prod-db-storage-replacement",
    labels: ["terraform", "production", "database", "requires-approval"],
    reviewers: ["cloud-platform", "database-owners"],
    files: [
      scenarioFile("modules/db/main.tf", "modified", 54, 21, "@@ aws_db_instance.primary replacement @@"),
      scenarioFile("modules/storage/efs.tf", "modified", 24, 11, "@@ aws_efs_file_system.shared replacement @@"),
      scenarioFile("envs/prod/variables.tfvars", "modified", 8, 4, "@@ production database sizing @@")
    ],
    resourceFileHints: [
      { match: "aws_db_instance.primary", file: "modules/db/main.tf:12" },
      { match: "aws_efs_file_system.shared", file: "modules/storage/efs.tf:9" }
    ],
    topRisks: [
      {
        severity: "critical",
        title: "RDS replacement in production",
        resource: "aws_db_instance.primary",
        recommendation: "Verify snapshot, maintenance window, rollback owner, and database owner signoff before merge."
      },
      {
        severity: "high",
        title: "Production backup retention reduced to 0",
        resource: "aws_db_instance.primary",
        recommendation: "Keep point-in-time recovery enabled for production databases."
      },
      {
        severity: "high",
        title: "EFS replacement changes shared storage",
        resource: "aws_efs_file_system.shared",
        recommendation: "Confirm restore path and dependent services before replacement."
      }
    ],
    fallbackCost: {
      monthly_delta: 240,
      threshold: 500,
      message: "Heuristic fallback from the changed RDS instance class. Configure Infracost for provider-grade deltas.",
      line_items: [
        {
          resource_address: "aws_db_instance.primary",
          resource_type: "aws_db_instance",
          description: "RDS db.r7g.2xlarge monthly baseline",
          monthly_delta: 240,
          confidence: 0.52
        }
      ]
    },
    fallbackBlast: {
      score: 96,
      level: "critical",
      summary: "Production RDS and EFS replacements can affect database availability, shared storage, and rollback time.",
      stateful_changes: [
        {
          resource_address: "aws_db_instance.primary",
          resource_type: "aws_db_instance",
          asset_class: "database",
          actions: ["delete", "create"],
          severity: "critical",
          factors: ["replacement", "backup retention set to 0", "deletion protection disabled"],
          dependencies: [{ name: "service", value: "orders-api" }],
          replacement_risk: "high",
          backup_status: "snapshot required before merge",
          deletion_protection: false,
          required_runbook: runbookChecklist("database"),
          rollback_checklist: runbookChecklist("database")
        },
        {
          resource_address: "aws_efs_file_system.shared",
          resource_type: "aws_efs_file_system",
          asset_class: "file_storage",
          actions: ["delete", "create"],
          severity: "high",
          factors: ["shared filesystem replacement"],
          dependencies: [{ name: "service", value: "worker fleet" }],
          replacement_risk: "high",
          backup_status: "AWS Backup recovery point required",
          deletion_protection: null,
          required_runbook: runbookChecklist("storage"),
          rollback_checklist: runbookChecklist("storage")
        }
      ]
    },
    patch: {
      id: "demo-destructive-prod-guardrails",
      finding_id: null,
      file: "modules/db/main.tf",
      summary: "Restore production database guardrails",
      diff: `@@ resource "aws_db_instance" "primary" {
- backup_retention_period = 0
- deletion_protection     = false
+ backup_retention_period = 7
+ deletion_protection     = true
+
+ lifecycle {
+   prevent_destroy = true
+ }
}`
    },
    auditNotes: [
      { action: "demo.scenario_selected", note: "Destructive production sample selected from hosted demo data." },
      { action: "policy_pack.selected", note: "restricted policy pack selected for production stateful changes." },
      { action: "github.check_drafted", note: "GitHub check would fail until human approval and guardrail remediation." }
    ]
  },
  "risky-security": {
    sample: "risky-security",
    title: "public access controls for web tier",
    repoOwner: "acme-infra",
    repoName: "terraform-edge",
    pullNumber: 74,
    environment: "prod",
    cloudProvider: "aws",
    policyProfile: "default",
    author: "network-admin",
    headRef: "web-public-access-rules",
    labels: ["terraform", "security", "networking"],
    reviewers: ["security", "cloud-platform"],
    files: [
      scenarioFile("modules/vpc/security-groups.tf", "modified", 28, 6, "@@ aws_security_group.web ingress @@"),
      scenarioFile("modules/db/rds.tf", "modified", 32, 9, "@@ aws_db_instance.main networking @@"),
      scenarioFile("modules/iam/admin-policy.tf", "modified", 15, 3, "@@ aws_iam_policy.admin permissions @@")
    ],
    resourceFileHints: [
      { match: "aws_security_group.web", file: "modules/vpc/security-groups.tf:45" },
      { match: "aws_db_instance.main", file: "modules/db/rds.tf:18" },
      { match: "aws_iam_policy.admin", file: "modules/iam/admin-policy.tf:11" }
    ],
    topRisks: [
      {
        severity: "critical",
        title: "Public SSH ingress",
        resource: "aws_security_group.web",
        recommendation: "Restrict SSH to approved CIDR ranges or use SSM Session Manager."
      },
      {
        severity: "high",
        title: "RDS publicly accessible",
        resource: "aws_db_instance.main",
        recommendation: "Move RDS into private subnets and require private security group access."
      },
      {
        severity: "high",
        title: "IAM wildcard policy",
        resource: "aws_iam_policy.admin",
        recommendation: "Replace Action and Resource wildcards with least-privilege statements."
      }
    ],
    fallbackCost: {
      monthly_delta: 240,
      threshold: 500,
      message: "Heuristic fallback from the new multi-AZ RDS instance in the security sample.",
      line_items: [
        {
          resource_address: "aws_db_instance.main",
          resource_type: "aws_db_instance",
          description: "RDS db.m6g.large multi-AZ monthly baseline",
          monthly_delta: 240,
          confidence: 0.52
        }
      ]
    },
    fallbackBlast: {
      score: 64,
      level: "high",
      summary: "No stateful replacement, but public admin ingress and public database access widen network exposure.",
      stateful_changes: []
    },
    patch: {
      id: "demo-security-public-ssh",
      finding_id: null,
      file: "modules/vpc/security-groups.tf",
      summary: "Restrict public SSH ingress",
      diff: `@@ resource "aws_security_group" "web" {
- cidr_blocks = ["0.0.0.0/0"]
+ cidr_blocks = var.approved_admin_cidrs
}`
    },
    auditNotes: [
      { action: "demo.scenario_selected", note: "Security exposure sample selected from hosted demo data." },
      { action: "github.pr_context_attached", note: "Mock PR context maps findings to VPC, RDS, and IAM files." },
      { action: "github.check_drafted", note: "GitHub check would fail because public exposure findings are blocking." }
    ]
  },
  "risky-cost": {
    sample: "risky-cost",
    title: "dev analytics cost spike",
    repoOwner: "acme-data",
    repoName: "terraform-platform",
    pullNumber: 203,
    environment: "staging",
    cloudProvider: "aws",
    policyProfile: "startup_cost_control",
    author: "data-platform",
    headRef: "analytics-search-capacity",
    labels: ["terraform", "cost-review", "analytics"],
    reviewers: ["finops", "data-platform"],
    files: [
      scenarioFile("modules/compute/workers.tf", "modified", 21, 4, "@@ aws_instance.worker instance_type @@"),
      scenarioFile("modules/network/egress.tf", "added", 18, 0, "@@ aws_nat_gateway.egress @@"),
      scenarioFile("modules/storage/analytics-volume.tf", "modified", 19, 6, "@@ aws_ebs_volume.analytics iops @@"),
      scenarioFile("modules/search/opensearch.tf", "added", 34, 0, "@@ aws_opensearch_domain.search @@")
    ],
    resourceFileHints: [
      { match: "aws_instance.worker", file: "modules/compute/workers.tf:9" },
      { match: "aws_nat_gateway.egress", file: "modules/network/egress.tf:22" },
      { match: "aws_ebs_volume.analytics", file: "modules/storage/analytics-volume.tf:14" },
      { match: "aws_opensearch_domain.search", file: "modules/search/opensearch.tf:7" }
    ],
    topRisks: [
      {
        severity: "high",
        title: "Large EC2 instance in non-prod",
        resource: "aws_instance.worker",
        recommendation: "Right-size the worker or require an explicit cost exception."
      },
      {
        severity: "high",
        title: "NAT Gateway created",
        resource: "aws_nat_gateway.egress",
        recommendation: "Use VPC endpoints for AWS service traffic where possible."
      },
      {
        severity: "medium",
        title: "High provisioned IOPS",
        resource: "aws_ebs_volume.analytics",
        recommendation: "Validate IOPS requirement and set a budget owner."
      }
    ],
    fallbackCost: {
      monthly_delta: 717.72,
      threshold: 250,
      message: "Heuristic fallback from EC2, NAT Gateway, EBS provisioned IOPS, and OpenSearch resources.",
      line_items: [
        {
          resource_address: "aws_instance.worker",
          resource_type: "aws_instance",
          description: "EC2 m7i.2xlarge monthly baseline",
          monthly_delta: 280.32,
          confidence: 0.58
        },
        {
          resource_address: "aws_ebs_volume.analytics",
          resource_type: "aws_ebs_volume",
          description: "EBS 2000 GiB plus 16000 provisioned IOPS",
          monthly_delta: 225,
          confidence: 0.68
        },
        {
          resource_address: "aws_opensearch_domain.search",
          resource_type: "aws_opensearch_domain",
          description: "OpenSearch small domain baseline",
          monthly_delta: 180,
          confidence: 0.55
        },
        {
          resource_address: "aws_nat_gateway.egress",
          resource_type: "aws_nat_gateway",
          description: "NAT Gateway hourly baseline",
          monthly_delta: 32.4,
          confidence: 0.78
        }
      ]
    },
    fallbackBlast: {
      score: 38,
      level: "medium",
      summary: "No destructive stateful replacement; impact is persistent AWS spend, quota use, and ownership gaps.",
      stateful_changes: []
    },
    patch: {
      id: "demo-cost-required-tags",
      finding_id: null,
      file: "modules/compute/workers.tf",
      summary: "Add cost ownership and right-sizing guardrail",
      diff: `@@ resource "aws_instance" "worker" {
- instance_type = "m7i.2xlarge"
+ instance_type = var.worker_instance_type
  tags = {
    owner       = "data"
    environment = "dev"
    service     = "batch"
+   cost_center = var.cost_center
  }
}`
    },
    auditNotes: [
      { action: "demo.scenario_selected", note: "Cost spike sample selected from hosted demo data." },
      { action: "cost.estimate_generated", note: "Heuristic AWS monthly delta generated from changed resources." },
      { action: "github.check_drafted", note: "GitHub check would warn or fail based on the configured monthly delta threshold." }
    ]
  },
  safe: {
    sample: "safe",
    title: "tagged logging bucket baseline",
    repoOwner: "acme-infra",
    repoName: "terraform-observability",
    pullNumber: 41,
    environment: "dev",
    cloudProvider: "aws",
    policyProfile: "default",
    author: "platform-admin",
    headRef: "logging-bucket-baseline",
    labels: ["terraform", "low-risk", "observability"],
    reviewers: ["cloud-platform"],
    files: [
      scenarioFile("modules/logging/s3.tf", "added", 44, 0, "@@ aws_s3_bucket.logs encrypted bucket @@"),
      scenarioFile("modules/logging/public-access.tf", "added", 26, 0, "@@ aws_s3_bucket_public_access_block.logs @@")
    ],
    resourceFileHints: [
      { match: "aws_s3_bucket.logs", file: "modules/logging/s3.tf:8" },
      { match: "aws_s3_bucket_public_access_block.logs", file: "modules/logging/public-access.tf:5" },
      { match: "aws_s3_bucket_server_side_encryption_configuration.logs", file: "modules/logging/s3.tf:31" }
    ],
    topRisks: [
      {
        severity: "info",
        title: "No blocking findings",
        resource: "aws_s3_bucket.logs",
        recommendation: "Proceed after normal peer review."
      }
    ],
    fallbackCost: {
      monthly_delta: 0,
      threshold: 500,
      message: "No material monthly delta detected in the safe sample.",
      line_items: []
    },
    fallbackBlast: {
      score: 4,
      level: "low",
      summary: "No destructive stateful changes detected.",
      stateful_changes: []
    },
    patch: null,
    auditNotes: [
      { action: "demo.scenario_selected", note: "Safe baseline sample selected from hosted demo data." },
      { action: "github.check_drafted", note: "GitHub check would pass with no blocking findings." }
    ]
  }
};

export const SHOWCASE_REPO = {
  owner: DEMO_SCENARIOS["destructive-prod"].repoOwner,
  name: DEMO_SCENARIOS["destructive-prod"].repoName,
  pullNumber: DEMO_SCENARIOS["destructive-prod"].pullNumber,
  sample: DEMO_SCENARIOS["destructive-prod"].sample,
  environment: DEMO_SCENARIOS["destructive-prod"].environment,
  cloudProvider: DEMO_SCENARIOS["destructive-prod"].cloudProvider,
  policyProfile: DEMO_SCENARIOS["destructive-prod"].policyProfile
};

export function demoScenarioReviewOptions(sample: string) {
  const scenario = getDemoScenario(sample);
  if (!scenario) return undefined;
  return {
    environment: scenario.environment,
    cloud_provider: scenario.cloudProvider,
    policy_profile: scenario.policyProfile,
    repo_owner: scenario.repoOwner,
    repo_name: scenario.repoName,
    pull_number: scenario.pullNumber
  };
}

export function isShowcaseRun(run: Pick<RunDetail, "repo_owner" | "repo_name" | "pull_number" | "terraform_execution">): boolean {
  return Boolean(resolveScenario(run));
}

export function isHomeShowcaseRun(run: Pick<RunDetail, "repo_owner" | "repo_name" | "pull_number" | "terraform_execution">): boolean {
  const scenario = resolveScenario(run);
  return scenario?.sample === SHOWCASE_REPO.sample && run.repo_owner === SHOWCASE_REPO.owner && run.repo_name === SHOWCASE_REPO.name && run.pull_number === SHOWCASE_REPO.pullNumber;
}

export function presentShowcaseRun(run: RunDetail): RunDetail {
  const scenario = resolveScenario(run);
  if (!scenario) return run;
  const cost = scenarioCost(run, scenario);
  const blastRadius = scenarioBlastRadius(run, scenario);
  const risk = calibratedScenarioRisk(run, scenario, cost, blastRadius);
  return {
    ...run,
    environment: run.environment || scenario.environment,
    cloud_provider: run.cloud_provider || scenario.cloudProvider,
    policy_profile: run.policy_profile || scenario.policyProfile,
    risk_score: risk.score,
    risk_level: risk.level,
    summary: run.summary || fallbackSummary(run, scenario),
    github_pr_context: scenarioContext(run, scenario),
    github_check: run.github_check ?? scenarioCheck(run, scenario),
    cost_estimate: cost,
    blast_radius: blastRadius
  };
}

export function presentShowcaseFindings(run: RunDetail, findings: Finding[]): Finding[] {
  const scenario = resolveScenario(run);
  if (!scenario) return findings;
  return findings.map((finding) => ({
    ...finding,
    pr_file_path: finding.pr_file_path ?? fileForFinding(scenario, finding),
    pr_file_url: finding.pr_file_url ?? null,
    pr_patch: finding.pr_patch ?? patchForFinding(scenario, finding),
    runbook_checklist: finding.runbook_checklist.length ? finding.runbook_checklist : runbookChecklist(finding.category)
  }));
}

export function presentShowcaseReport(run: RunDetail, report: Report): Report {
  const scenario = resolveScenario(run);
  if (!scenario) return report;
  const counts = severitySummary(run.severity_counts);
  const monthly = scenarioCost(run, scenario).monthly_delta ?? 0;
  return {
    ...report,
    pr_comment_draft: `## TerraGate Review

Overall risk: ${titleCase(run.risk_level)} (${run.risk_score}/100)
Findings: ${counts}
Environment: ${run.environment}
Repository: ${scenario.repoOwner}/${scenario.repoName}
Pull request: #${scenario.pullNumber} - ${scenario.title}
Cost delta: ${money(monthly)}/mo
Run ID: ${run.id}

### Top risks
${scenario.topRisks.map((risk, index) => `${index + 1}. ${titleCase(risk.severity)} - ${risk.title}
   - Resource: ${risk.resource}
   - Recommendation: ${risk.recommendation}`).join("\n\n")}

### Suggested next step
${scenario.patch ? `Review the generated patch for ${scenario.patch.file}, then approve before any GitHub write.` : "No patch is required for this sample; proceed through normal approval."}

Human approval required before posting.`,
    remediation_summary: scenario.patch
      ? `Generated a scenario-specific Terraform patch for ${scenario.patch.file} plus an operational checklist.`
      : "No blocking remediation required for the safe sample.",
    risk_score: {
      overall_score: run.risk_score,
      risk_level: run.risk_level as Report["risk_score"]["risk_level"],
      summary: run.summary || fallbackSummary(run, scenario),
      top_drivers: scenario.topRisks.map((risk) => risk.title)
    }
  };
}

export function presentShowcasePatches(run: RunDetail, patches: FixPatch[]): FixPatch[] {
  const scenario = resolveScenario(run);
  if (!scenario?.patch || patches.some((patch) => patch.id === scenario.patch?.id)) return patches;
  return [
    ...patches,
    {
      id: scenario.patch.id,
      run_id: run.id,
      finding_id: scenario.patch.finding_id,
      status: "draft",
      pr_file_path: scenario.patch.file,
      summary: scenario.patch.summary,
      diff: scenario.patch.diff,
      created_at: run.created_at,
      approved_at: null,
      commit_url: null,
      committed_at: null
    }
  ];
}

export function presentShowcaseAudit(run: RunDetail, entries: AuditLogEntry[]): AuditLogEntry[] {
  const scenario = resolveScenario(run);
  if (!scenario) return entries;
  const existing = new Set(entries.map((entry) => entry.action));
  const additions = scenario.auditNotes
    .filter((note) => !existing.has(note.action))
    .map((note) => auditEntry(run, note.action, note.note));
  return [...additions, ...entries];
}

export function presentRunListItem(run: RunListItem): RunListItem {
  if (run.risk_score < 100) return run;
  const score = calibratedListRiskScore(run);
  return {
    ...run,
    risk_score: score,
    risk_level: score >= 80 ? "critical" : score >= 50 ? "high" : score >= 20 ? "medium" : "low"
  };
}

function getDemoScenario(sample: string): DemoScenario | null {
  return Object.prototype.hasOwnProperty.call(DEMO_SCENARIOS, sample) ? DEMO_SCENARIOS[sample as DemoSample] : null;
}

function resolveScenario(run: Pick<RunDetail, "repo_owner" | "repo_name" | "pull_number" | "terraform_execution">): DemoScenario | null {
  const sample = run.terraform_execution?.sample;
  if (sample) {
    return getDemoScenario(sample);
  }
  return (
    Object.values(DEMO_SCENARIOS).find(
      (scenario) => scenario.repoOwner === run.repo_owner && scenario.repoName === run.repo_name && scenario.pullNumber === run.pull_number
    ) ?? null
  );
}

function scenarioContext(run: RunDetail, scenario: DemoScenario): GitHubPRContext {
  const existing = run.github_pr_context;
  const files = existing?.files?.length ? existing.files : scenario.files.map(toGithubFile);
  return {
    available: existing?.available ?? false,
    mock: existing?.mock ?? true,
    message: existing?.message ?? "Public demo mode: safe seeded PR context shown without live GitHub reads.",
    repo_owner: existing?.repo_owner ?? scenario.repoOwner,
    repo_name: existing?.repo_name ?? scenario.repoName,
    repo_full_name: existing?.repo_full_name ?? `${scenario.repoOwner}/${scenario.repoName}`,
    pull_number: existing?.pull_number ?? scenario.pullNumber,
    title: existing?.title ?? scenario.title,
    state: existing?.state ?? "open",
    draft: existing?.draft ?? false,
    author: existing?.author ?? scenario.author,
    base_ref: existing?.base_ref ?? "main",
    head_ref: existing?.head_ref ?? scenario.headRef,
    html_url: existing?.html_url ?? null,
    latest_commit_sha: existing?.latest_commit_sha ?? demoSha(run.id, scenario.sample),
    changed_files_count: existing?.changed_files_count || scenario.files.length,
    additions: existing?.additions || scenario.files.reduce((sum, file) => sum + file.additions, 0),
    deletions: existing?.deletions || scenario.files.reduce((sum, file) => sum + file.deletions, 0),
    labels: existing?.labels?.length ? existing.labels : scenario.labels,
    requested_reviewers: existing?.requested_reviewers?.length ? existing.requested_reviewers : scenario.reviewers,
    files,
    terraform_files: existing?.terraform_files?.length ? existing.terraform_files : files,
    fetched_at: existing?.fetched_at ?? run.completed_at ?? run.created_at
  };
}

function scenarioCheck(run: RunDetail, scenario: DemoScenario): RunDetail["github_check"] {
  const state = run.risk_level === "critical" || run.risk_level === "high" ? "fail" : run.risk_level === "medium" ? "warn" : "pass";
  const conclusion = state === "fail" ? "failure" : state === "warn" ? "neutral" : "success";
  return {
    id: `demo-check-${scenario.sample}`,
    status: "completed",
    conclusion,
    state,
    check_url: null,
    message:
      state === "fail"
        ? "Public demo mode: this PR would receive a failing check until blocking risks are approved or remediated."
        : state === "warn"
          ? "Public demo mode: this PR would receive a warning check for reviewer attention."
          : "Public demo mode: this PR would receive a passing check.",
    updated_at: run.completed_at ?? run.created_at
  };
}

function scenarioCost(run: RunDetail, scenario: DemoScenario): RunDetail["cost_estimate"] {
  const monthly = Number(run.cost_estimate.monthly_delta ?? 0);
  const hasApiCost = Number.isFinite(monthly) && (monthly !== 0 || Boolean(run.cost_estimate.line_items?.length));
  if (hasApiCost) return run.cost_estimate;
  return {
    ...run.cost_estimate,
    currency: "USD",
    monthly_delta: scenario.fallbackCost.monthly_delta,
    annual_delta: Number((scenario.fallbackCost.monthly_delta * 12).toFixed(2)),
    threshold: scenario.fallbackCost.threshold,
    over_threshold: scenario.fallbackCost.monthly_delta > scenario.fallbackCost.threshold,
    source: "heuristic_fallback",
    message: scenario.fallbackCost.message,
    line_items: scenario.fallbackCost.line_items.map((item) => ({ ...item, source: "heuristic" }))
  };
}

function scenarioBlastRadius(run: RunDetail, scenario: DemoScenario): RunDetail["blast_radius"] {
  if (run.blast_radius.stateful_changes?.length || run.blast_radius.summary) {
    return run.blast_radius;
  }
  return scenario.fallbackBlast;
}

function calibratedScenarioRisk(
  run: RunDetail,
  scenario: DemoScenario,
  cost: RunDetail["cost_estimate"],
  blastRadius: RunDetail["blast_radius"]
): { score: number; level: string } {
  if (scenario.sample === "safe" && Object.values(run.severity_counts).every((count) => (count ?? 0) === 0)) {
    return { score: 4, level: "low" };
  }

  const counts = run.severity_counts;
  const severityComponent = Math.min(
    55,
    (counts.critical ?? 0) * 18 + (counts.high ?? 0) * 8 + (counts.medium ?? 0) * 3 + (counts.low ?? 0)
  );
  const statefulChanges = blastRadius.stateful_changes ?? [];
  const statefulBonus = Math.min(25, statefulChanges.length * 12 + statefulChanges.filter((item) => item.severity === "critical").length * 5);
  const monthlyDelta = Number(cost.monthly_delta ?? 0);
  const threshold = Number(cost.threshold ?? 500);
  const costBonus = monthlyDelta > threshold && scenario.sample === "risky-cost" ? 24 : monthlyDelta > 0 ? 8 : 0;
  const exposureBonus = scenario.sample === "risky-security" ? 26 : 0;
  const prodBonus = run.environment === "prod" ? 8 : 0;
  const score = Math.min(100, Math.round(severityComponent + statefulBonus + costBonus + exposureBonus + prodBonus));
  return {
    score,
    level: score >= 80 ? "critical" : score >= 50 ? "high" : score >= 20 ? "medium" : "low"
  };
}

function calibratedListRiskScore(run: Pick<RunListItem, "severity_counts" | "environment">): number {
  const counts = run.severity_counts;
  if (Object.values(counts).every((count) => (count ?? 0) === 0)) return 4;
  const severityComponent = Math.min(
    55,
    (counts.critical ?? 0) * 18 + (counts.high ?? 0) * 8 + (counts.medium ?? 0) * 3 + (counts.low ?? 0)
  );
  const prodBonus = run.environment === "prod" ? 8 : 0;
  const criticalBonus = (counts.critical ?? 0) > 0 ? 33 : 0;
  const publicExposureProxy = (counts.critical ?? 0) === 0 && (counts.high ?? 0) >= 5 && run.environment === "prod" ? 34 : 0;
  const costSpreadProxy = (counts.critical ?? 0) === 0 && (counts.high ?? 0) <= 1 && (counts.medium ?? 0) >= 5 ? 24 : 0;
  return Math.min(100, Math.round(severityComponent + prodBonus + criticalBonus + publicExposureProxy + costSpreadProxy));
}

function fileForFinding(scenario: DemoScenario, finding: Finding): string | null {
  const haystack = [finding.resource_address, finding.resource_type, finding.title].filter(Boolean).join(" ");
  return scenario.resourceFileHints.find((hint) => haystack.includes(hint.match))?.file ?? scenario.files[0]?.filename ?? null;
}

function patchForFinding(scenario: DemoScenario, finding: Finding): string | null {
  if (!scenario.patch) return finding.pr_patch;
  const file = fileForFinding(scenario, finding);
  return file?.startsWith(scenario.patch.file) ? scenario.patch.diff : finding.pr_patch;
}

function fallbackSummary(run: RunDetail, scenario: DemoScenario): string {
  if (scenario.sample === "safe") return "No blocking Terraform risks detected in the hosted safe sample.";
  const counts = severitySummary(run.severity_counts);
  return `${counts} detected for ${scenario.title}.`;
}

function severitySummary(counts: Record<string, number>): string {
  return `${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.medium ?? 0} medium, ${counts.low ?? 0} low`;
}

function toGithubFile(file: ScenarioFile): GitHubPRContext["files"][number] {
  return {
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch,
    raw_url: null,
    blob_url: null
  };
}

function scenarioFile(filename: string, status: string, additions: number, deletions: number, patch: string): ScenarioFile {
  return {
    filename,
    status,
    additions,
    deletions,
    changes: additions + deletions,
    patch
  };
}

function runbookChecklist(kind: Category | "database" | "storage"): string[] {
  if (kind === "cost") {
    return ["Monthly delta reviewed", "Budget owner assigned", "Right-sizing option checked", "Exception approved if threshold exceeded", "Post-apply cost watch configured"];
  }
  if (kind === "security") {
    return ["Approved CIDR or private access path confirmed", "Public exposure exception documented", "Security owner signoff recorded", "Rollback rule prepared", "Post-apply reachability validated"];
  }
  return ["Backup and snapshot verified", "Maintenance window approved", "Rollback typed and owner assigned", "Owner signoff obtained", "Post-apply validation complete"];
}

function auditEntry(run: RunDetail, action: string, note: string): AuditLogEntry {
  return {
    id: `demo-${action}-${run.id}`,
    action,
    actor_email: "platform-admin@example.com",
    target_type: "run",
    target_id: run.id,
    metadata: { note },
    created_at: run.completed_at ?? run.created_at
  };
}

function demoSha(runId: string, sample: string): string {
  return `${sample.replace(/[^a-z0-9]/gi, "").slice(0, 6)}${runId.replace(/^run_/, "").slice(0, 6)}`.slice(0, 12);
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}
