from typing import Any

from app.config import get_settings
from app.graph.terraform_review.nodes.common import mark_node
from app.graph.terraform_review.nodes.security_reviewer import _resource_summaries
from app.services.llm import summarize_with_llm


def governance_reviewer(state: dict[str, Any]) -> dict[str, Any]:
    findings = [
        {**finding, "reviewer_node": "governance_reviewer"}
        for finding in state.get("deterministic_results", [])
        if finding.get("category") == "governance"
    ]
    findings = summarize_with_llm(
        get_settings(),
        "governance_reviewer",
        "governance",
        findings,
        _resource_summaries(state.get("resource_changes", [])),
    )
    return {**mark_node(state, "governance_reviewer"), "governance_findings": findings}
