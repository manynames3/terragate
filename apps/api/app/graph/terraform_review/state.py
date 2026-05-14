from typing import Any, TypedDict


class TerraformReviewState(TypedDict, total=False):
    run_id: str
    user_id: str | None
    mode: str
    input_artifacts: list[dict[str, Any]]
    repo_context: dict[str, Any]
    policy_profile: str
    environment: str
    cloud_provider: str
    raw_plan: dict[str, Any]
    redacted_plan: dict[str, Any]
    raw_plan_ref: str
    redacted_plan_ref: str
    redacted_plan_sha256: str
    plan_summary: dict[str, Any]
    resource_changes: list[dict[str, Any]]
    sensitive_paths: list[dict[str, Any]]
    deterministic_results: list[dict[str, Any]]
    policy_pack: dict[str, Any]
    cost_estimate: dict[str, Any]
    blast_radius: dict[str, Any]
    security_findings: list[dict[str, Any]]
    cost_findings: list[dict[str, Any]]
    reliability_findings: list[dict[str, Any]]
    governance_findings: list[dict[str, Any]]
    merged_findings: list[dict[str, Any]]
    pr_mapped_findings: list[dict[str, Any]]
    remediations: list[dict[str, Any]]
    compliance_mappings: dict[str, list[str]]
    risk_score: dict[str, Any]
    pr_comment_draft: str
    report_markdown: str
    remediation_summary: str
    approval_status: str
    approval_notes: str | None
    github_comment_url: str | None
    trace_id: str | None
    graph_progress: list[dict[str, Any]]
    artifact_storage_dir: str
