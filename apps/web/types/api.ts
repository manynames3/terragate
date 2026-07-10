export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Category = "security" | "cost" | "reliability" | "governance" | "compliance";

export type Evidence = {
  source_artifact: string | null;
  json_path: string;
  observed_value: unknown;
  expected_value: unknown | null;
  rule_id: string | null;
  explanation: string;
};

export type Remediation = {
  language: string;
  snippet: string;
  explanation: string;
  risk_of_change: "low" | "medium" | "high";
};

export type GitHubPRFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  raw_url: string | null;
  blob_url: string | null;
};

export type GitHubPRContext = {
  available: boolean;
  mock: boolean;
  message: string;
  repo_owner: string | null;
  repo_name: string | null;
  repo_full_name: string | null;
  pull_number: number | null;
  title: string | null;
  state: string | null;
  draft: boolean | null;
  author: string | null;
  base_ref: string | null;
  head_ref: string | null;
  html_url: string | null;
  latest_commit_sha: string | null;
  changed_files_count: number;
  additions: number;
  deletions: number;
  labels: string[];
  requested_reviewers: string[];
  files: GitHubPRFile[];
  terraform_files: GitHubPRFile[];
  fetched_at: string | null;
};

export type AuthUser = {
  id: string | null;
  email: string;
  name: string;
  role: "platform-admin" | "reviewer" | "viewer";
  org_id: string | null;
  groups: string[];
  auth_provider: "dev" | "cognito";
};

export type RuntimeCapabilities = {
  environment: string;
  public_demo: boolean;
  auth_provider: "dev" | "cognito";
  review_execution_mode: string;
  max_upload_bytes: number | null;
  github_reads: "live" | "disabled";
  github_writes: "live" | "mocked" | "disabled";
  terraform_sandbox: "enabled" | "disabled";
  terraform_sandbox_driver: string | null;
  cost_estimation: "infracost" | "heuristic";
  llm_enrichment: "enabled" | "disabled";
  tracing: "enabled" | "disabled";
};

export type DemoSamplePlan = {
  sample: string;
  filename: string;
  label: string;
  description: string;
  environment: string;
  cloud_provider: string;
  policy_profile: string;
};

export type Finding = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  category: Category;
  resource_address: string | null;
  resource_type: string | null;
  provider: string | null;
  change_actions: string[];
  evidence: Evidence[];
  impact: string;
  recommendation: string;
  remediation: Remediation | null;
  compliance_refs: string[];
  confidence: number;
  source: "deterministic_rule" | "llm_reviewer" | "external_scanner";
  reviewer_node: string;
  requires_human_review: boolean;
  pr_file_path: string | null;
  pr_file_url: string | null;
  pr_patch: string | null;
  runbook_checklist: string[];
};

export type RunListItem = {
  id: string;
  mode: string;
  status: string;
  environment: string;
  cloud_provider: string;
  risk_score: number;
  risk_level: string;
  summary: string;
  approval_status: string;
  created_at: string;
  completed_at: string | null;
  severity_counts: Record<string, number>;
};

export type RunDetail = RunListItem & {
  policy_profile: string;
  trace_id: string | null;
  graph_progress: Array<{ node: string; status: string; timestamp: string }>;
  plan_summary: {
    total_resource_changes?: number;
    creates?: number;
    updates?: number;
    deletes?: number;
    replacements?: number;
    no_ops?: number;
    resource_types_affected?: Record<string, number>;
    providers_affected?: Record<string, number>;
  };
  cost_estimate: {
    currency?: string;
    monthly_delta?: number;
    annual_delta?: number;
    threshold?: number;
    over_threshold?: boolean;
    source?: string;
    message?: string;
    line_items?: Array<{
      resource_address?: string | null;
      resource_type?: string | null;
      description?: string;
      monthly_delta?: number;
      confidence?: number;
      source?: string;
    }>;
  };
  blast_radius: {
    score?: number;
    level?: string;
    summary?: string;
    stateful_changes?: Array<{
      resource_address?: string | null;
      resource_type?: string | null;
      asset_class?: string;
      actions?: string[];
      severity?: string;
      factors?: string[];
      dependencies?: Array<{ name: string; value: unknown }>;
      replacement_risk?: string;
      backup_status?: string;
      deletion_protection?: boolean | null;
      required_runbook?: string[];
      rollback_checklist?: string[];
    }>;
  };
  terraform_execution: {
    mode?: string;
    enabled?: boolean;
    sample?: string;
    source?: string;
    source_working_dir?: string;
    plan_json_path?: string;
    refresh?: boolean;
    backend?: boolean;
    warnings?: string[];
  };
  repo_owner: string | null;
  repo_name: string | null;
  pull_number: number | null;
  github_pr_context: GitHubPRContext | null;
  job: ReviewJob | null;
  github_check: GitHubCheck | null;
  fix_patch_count: number;
  audit_event_count: number;
  artifacts: ArtifactSummary[];
};

export type ReviewJob = {
  id: string;
  status: string;
  attempts: number;
  error: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type GitHubCheck = {
  id: string;
  status: string;
  conclusion: string | null;
  state: "pass" | "warn" | "fail" | "pending";
  check_url: string | null;
  message: string;
  updated_at: string;
};

export type FixPatch = {
  id: string;
  run_id: string;
  finding_id: string | null;
  status: string;
  pr_file_path: string | null;
  summary: string;
  diff: string;
  created_at: string;
  approved_at: string | null;
  commit_url: string | null;
  committed_at: string | null;
};

export type AuditLogEntry = {
  id: string;
  action: string;
  actor_email: string | null;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ArtifactSummary = {
  id: string;
  type: string;
  sha256: string;
  redacted: boolean;
  created_at: string;
};

export type RunbookProgressEntry = {
  step_id: string;
  section_id: string | null;
  checked: boolean;
  actor_email: string | null;
  updated_at: string;
};

export type PolicyPack = {
  name: string;
  description: string;
  required_tags: string[];
  allowed_regions: string[];
  allowed_instance_families: string[];
  max_monthly_delta: number;
  restricted_allowlist: string[];
  require_cost_center: boolean;
  block_public_admin_ingress: boolean;
  block_production_stateful_deletes: boolean;
  require_deletion_protection_in_prod: boolean;
  min_prod_backup_retention_days: number;
};

export type RiskScore = {
  overall_score: number;
  risk_level: "low" | "medium" | "high" | "critical";
  summary: string;
  top_drivers: string[];
};

export type Report = {
  run_id: string;
  report_markdown: string;
  pr_comment_draft: string;
  remediation_summary: string;
  risk_score: RiskScore;
};

export type GitHubCommentResponse = {
  run_id: string;
  posted: boolean;
  mock: boolean;
  message: string;
  comment_url: string | null;
};

export type PatchCommitResponse = {
  run_id: string;
  patch_id: string;
  committed: boolean;
  mock: boolean;
  message: string;
  commit_url: string | null;
};
