from typing import Any

from app.graph.terraform_review.nodes.common import mark_node
from app.services.terraform_plan import extract_resource_changes, summarize_plan


def normalize_resource_changes(state: dict[str, Any]) -> dict[str, Any]:
    resource_changes = extract_resource_changes(state["redacted_plan"])
    return {
        **mark_node(state, "normalize_resource_changes"),
        "resource_changes": resource_changes,
        "plan_summary": summarize_plan(resource_changes),
    }
