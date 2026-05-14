from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


Severity = Literal["critical", "high", "medium", "low", "info"]
Category = Literal["security", "cost", "reliability", "governance", "compliance"]
FindingSource = Literal["deterministic_rule", "llm_reviewer", "external_scanner"]


class Evidence(BaseModel):
    source_artifact: str | None = None
    json_path: str
    observed_value: Any
    expected_value: Any | None = None
    rule_id: str | None = None
    explanation: str


class Remediation(BaseModel):
    language: str = "hcl"
    snippet: str
    explanation: str
    risk_of_change: Literal["low", "medium", "high"] = "medium"


class Finding(BaseModel):
    id: str
    title: str
    description: str
    severity: Severity
    category: Category
    resource_address: str | None = None
    resource_type: str | None = None
    provider: str | None = None
    change_actions: list[str] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    impact: str = ""
    recommendation: str = ""
    remediation: Remediation | None = None
    compliance_refs: list[str] = Field(default_factory=list)
    confidence: float = 1.0
    source: FindingSource = "deterministic_rule"
    reviewer_node: str = "deterministic_policy_checks"
    requires_human_review: bool = False
    pr_file_path: str | None = None
    pr_file_url: str | None = None
    pr_patch: str | None = None
    runbook_checklist: list[str] = Field(default_factory=list)


class RiskScore(BaseModel):
    overall_score: int
    risk_level: Literal["low", "medium", "high", "critical"]
    summary: str
    top_drivers: list[str] = Field(default_factory=list)


class PlanSummary(BaseModel):
    total_resource_changes: int = 0
    creates: int = 0
    updates: int = 0
    deletes: int = 0
    replacements: int = 0
    no_ops: int = 0
    resource_types_affected: dict[str, int] = Field(default_factory=dict)
    providers_affected: dict[str, int] = Field(default_factory=dict)


class GitHubPRFile(BaseModel):
    filename: str
    status: str
    additions: int
    deletions: int
    changes: int
    patch: str | None = None
    raw_url: str | None = None
    blob_url: str | None = None


class GitHubPRContext(BaseModel):
    available: bool
    mock: bool
    message: str
    repo_owner: str | None = None
    repo_name: str | None = None
    repo_full_name: str | None = None
    pull_number: int | None = None
    title: str | None = None
    state: str | None = None
    draft: bool | None = None
    author: str | None = None
    base_ref: str | None = None
    head_ref: str | None = None
    html_url: str | None = None
    latest_commit_sha: str | None = None
    changed_files_count: int = 0
    additions: int = 0
    deletions: int = 0
    labels: list[str] = Field(default_factory=list)
    requested_reviewers: list[str] = Field(default_factory=list)
    files: list[GitHubPRFile] = Field(default_factory=list)
    terraform_files: list[GitHubPRFile] = Field(default_factory=list)
    fetched_at: str | None = None


class AuthUser(BaseModel):
    id: str | None = None
    email: str
    name: str
    role: Literal["platform-admin", "reviewer", "viewer"]
    org_id: str | None = None
    groups: list[str] = Field(default_factory=list)
    auth_provider: Literal["dev", "cognito"]


class TerraformReviewCreateResponse(BaseModel):
    run_id: str
    status: str


class ReviewJob(BaseModel):
    id: str
    status: str
    attempts: int
    error: str | None = None
    queued_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class GitHubCheck(BaseModel):
    id: str
    status: str
    conclusion: str | None = None
    state: Literal["pass", "warn", "fail", "pending"]
    check_url: str | None = None
    message: str
    updated_at: datetime


class FixPatch(BaseModel):
    id: str
    run_id: str
    finding_id: str | None = None
    status: str
    pr_file_path: str | None = None
    summary: str
    diff: str
    created_at: datetime
    approved_at: datetime | None = None
    commit_url: str | None = None
    committed_at: datetime | None = None


class AuditLogEntry(BaseModel):
    id: str
    action: str
    actor_email: str | None = None
    target_type: str
    target_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class RunListItem(BaseModel):
    id: str
    mode: str
    status: str
    environment: str
    cloud_provider: str
    risk_score: int
    risk_level: str
    summary: str
    approval_status: str
    created_at: datetime
    completed_at: datetime | None = None
    severity_counts: dict[str, int] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)


class RunDetail(BaseModel):
    id: str
    mode: str
    status: str
    environment: str
    cloud_provider: str
    policy_profile: str
    risk_score: int
    risk_level: str
    summary: str
    trace_id: str | None = None
    graph_progress: list[dict[str, Any]] = Field(default_factory=list)
    plan_summary: dict[str, Any] = Field(default_factory=dict)
    cost_estimate: dict[str, Any] = Field(default_factory=dict)
    blast_radius: dict[str, Any] = Field(default_factory=dict)
    terraform_execution: dict[str, Any] = Field(default_factory=dict)
    approval_status: str
    repo_owner: str | None = None
    repo_name: str | None = None
    pull_number: int | None = None
    github_pr_context: GitHubPRContext | None = None
    job: ReviewJob | None = None
    github_check: GitHubCheck | None = None
    fix_patch_count: int = 0
    audit_event_count: int = 0
    created_at: datetime
    completed_at: datetime | None = None
    severity_counts: dict[str, int] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)


class ReportResponse(BaseModel):
    run_id: str
    report_markdown: str
    pr_comment_draft: str
    remediation_summary: str
    risk_score: RiskScore


class ApprovalRequest(BaseModel):
    notes: str | None = None


class DecisionResponse(BaseModel):
    run_id: str
    decision: Literal["approved", "rejected"]
    status: str


class GitHubCommentResponse(BaseModel):
    run_id: str
    posted: bool
    mock: bool
    message: str
    comment_url: str | None = None


class PatchCommitResponse(BaseModel):
    run_id: str
    patch_id: str
    committed: bool
    mock: bool
    message: str
    commit_url: str | None = None
