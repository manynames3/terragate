from typing import Any

from app.graph.terraform_review.nodes.common import mark_node


def github_comment_writer(state: dict[str, Any]) -> dict[str, Any]:
    if state.get("approval_status") != "approved":
        return {
            **mark_node(state, "github_comment_writer", status="skipped_pending_approval"),
            "github_comment_url": None,
        }
    return {
        **mark_node(state, "github_comment_writer", status="ready_for_external_post"),
        "github_comment_url": state.get("github_comment_url"),
    }
