from typing import Any

from langgraph.graph import END, START, StateGraph

from app.graph.terraform_review.nodes.approval import human_approval_gate
from app.graph.terraform_review.nodes.compliance import compliance_mapper
from app.graph.terraform_review.nodes.cost_reviewer import cost_reviewer
from app.graph.terraform_review.nodes.github import github_comment_writer
from app.graph.terraform_review.nodes.governance_reviewer import governance_reviewer
from app.graph.terraform_review.nodes.ingest import ingest_plan
from app.graph.terraform_review.nodes.merge import deduplicate_and_rank, merge_findings
from app.graph.terraform_review.nodes.normalize import normalize_resource_changes
from app.graph.terraform_review.nodes.policy_checks import deterministic_policy_checks
from app.graph.terraform_review.nodes.pr_context import map_github_pr_context
from app.graph.terraform_review.nodes.reliability_reviewer import reliability_reviewer
from app.graph.terraform_review.nodes.remediation import generate_remediations
from app.graph.terraform_review.nodes.report import report_builder
from app.graph.terraform_review.nodes.security_reviewer import security_reviewer
from app.graph.terraform_review.nodes.validate import validate_and_redact
from app.graph.terraform_review.state import TerraformReviewState


def build_terraform_review_graph():
    builder = StateGraph(TerraformReviewState)
    builder.add_node("ingest_plan", ingest_plan)
    builder.add_node("validate_and_redact", validate_and_redact)
    builder.add_node("normalize_resource_changes", normalize_resource_changes)
    builder.add_node("deterministic_policy_checks", deterministic_policy_checks)
    builder.add_node("security_reviewer", security_reviewer)
    builder.add_node("cost_reviewer", cost_reviewer)
    builder.add_node("reliability_reviewer", reliability_reviewer)
    builder.add_node("governance_reviewer", governance_reviewer)
    builder.add_node("merge_findings", merge_findings)
    builder.add_node("deduplicate_and_rank", deduplicate_and_rank)
    builder.add_node("map_github_pr_context", map_github_pr_context)
    builder.add_node("generate_remediations", generate_remediations)
    builder.add_node("compliance_mapper", compliance_mapper)
    builder.add_node("report_builder", report_builder)
    builder.add_node("human_approval_gate", human_approval_gate)
    builder.add_node("github_comment_writer", github_comment_writer)

    builder.add_edge(START, "ingest_plan")
    builder.add_edge("ingest_plan", "validate_and_redact")
    builder.add_edge("validate_and_redact", "normalize_resource_changes")
    builder.add_edge("normalize_resource_changes", "deterministic_policy_checks")
    builder.add_edge("deterministic_policy_checks", "security_reviewer")
    builder.add_edge("security_reviewer", "cost_reviewer")
    builder.add_edge("cost_reviewer", "reliability_reviewer")
    builder.add_edge("reliability_reviewer", "governance_reviewer")
    builder.add_edge("governance_reviewer", "merge_findings")
    builder.add_edge("merge_findings", "deduplicate_and_rank")
    builder.add_edge("deduplicate_and_rank", "map_github_pr_context")
    builder.add_edge("map_github_pr_context", "generate_remediations")
    builder.add_edge("generate_remediations", "compliance_mapper")
    builder.add_edge("compliance_mapper", "report_builder")
    builder.add_edge("report_builder", "human_approval_gate")
    builder.add_edge("human_approval_gate", "github_comment_writer")
    builder.add_edge("github_comment_writer", END)
    return builder.compile()


def run_terraform_review(initial_state: dict[str, Any]) -> dict[str, Any]:
    graph = build_terraform_review_graph()
    return graph.invoke(initial_state)
