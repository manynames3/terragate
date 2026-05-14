from typing import Any

from app.graph.terraform_review.nodes.common import mark_node


def human_approval_gate(state: dict[str, Any]) -> dict[str, Any]:
    return {
        **mark_node(state, "human_approval_gate"),
        "approval_status": state.get("approval_status") or "pending",
    }
