from app.config import get_settings
from app.graph.terraform_review.nodes.common import mark_node
from app.services.grounded_review import review


def grounded_review(state):
    settings = get_settings()
    if settings.reviewer_version == "legacy-v1":
        return mark_node(state, "grounded_review", "skipped")
    result = review(
        settings, state.get("resource_changes", []), state.get("merged_findings", [])
    )
    return {
        **mark_node(state, "grounded_review"),
        "merged_findings": result["findings"],
        "grounded_assessment": result["review"],
    }
