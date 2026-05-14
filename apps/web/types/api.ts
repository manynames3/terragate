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
  repo_owner: string | null;
  repo_name: string | null;
  pull_number: number | null;
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
