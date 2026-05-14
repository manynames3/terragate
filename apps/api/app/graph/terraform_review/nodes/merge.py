from typing import Any

from app.graph.terraform_review.nodes.common import mark_node


SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def merge_findings(state: dict[str, Any]) -> dict[str, Any]:
    merged = []
    for key in (
        "security_findings",
        "cost_findings",
        "reliability_findings",
        "governance_findings",
    ):
        merged.extend(state.get(key, []))
    return {**mark_node(state, "merge_findings"), "merged_findings": merged}


def deduplicate_and_rank(state: dict[str, Any]) -> dict[str, Any]:
    seen: dict[tuple[str, str, str], dict[str, Any]] = {}
    for finding in state.get("merged_findings", []):
        key = (
            finding.get("title", ""),
            finding.get("resource_address", ""),
            finding.get("category", ""),
        )
        existing = seen.get(key)
        if not existing or SEVERITY_ORDER.get(finding.get("severity", "info"), 99) < SEVERITY_ORDER.get(
            existing.get("severity", "info"), 99
        ):
            seen[key] = finding
    ranked = sorted(
        seen.values(),
        key=lambda item: (
            SEVERITY_ORDER.get(item.get("severity", "info"), 99),
            item.get("category", ""),
            item.get("resource_address") or "",
        ),
    )
    return {**mark_node(state, "deduplicate_and_rank"), "merged_findings": ranked}
