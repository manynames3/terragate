from typing import Any

from app.graph.terraform_review.nodes.common import mark_node


def ingest_plan(state: dict[str, Any]) -> dict[str, Any]:
    artifacts = list(state.get("input_artifacts", []))
    return {
        **mark_node(state, "ingest_plan"),
        "mode": state.get("mode", "terraform_pr_review"),
        "input_artifacts": artifacts,
    }
