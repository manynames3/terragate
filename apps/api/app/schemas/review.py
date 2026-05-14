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


class TerraformReviewCreateResponse(BaseModel):
    run_id: str
    status: str


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
    approval_status: str
    repo_owner: str | None = None
    repo_name: str | None = None
    pull_number: int | None = None
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
