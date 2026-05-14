from typing import Any

from app.config import get_settings
from app.graph.terraform_review.nodes.common import mark_node
from app.services.llm import summarize_with_llm


def security_reviewer(state: dict[str, Any]) -> dict[str, Any]:
    findings = _review_category(state, "security", "security_reviewer")
    return {**mark_node(state, "security_reviewer"), "security_findings": findings}


def _review_category(state: dict[str, Any], category: str, node: str) -> list[dict[str, Any]]:
    findings = [
        {**finding, "reviewer_node": node}
        for finding in state.get("deterministic_results", [])
        if finding.get("category") == category
    ]
    resources = _resource_summaries(state.get("resource_changes", []))
    return summarize_with_llm(get_settings(), node, category, findings, resources)


def _resource_summaries(resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "address": resource.get("address"),
            "type": resource.get("type"),
            "actions": resource.get("change", {}).get("actions", []),
        }
        for resource in resources
    ]
