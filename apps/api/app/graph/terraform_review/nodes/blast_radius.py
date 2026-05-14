from typing import Any

from app.graph.terraform_review.nodes.common import mark_node
from app.services.blast_radius import analyze_blast_radius


def blast_radius_analyzer(state: dict[str, Any]) -> dict[str, Any]:
    blast_radius = analyze_blast_radius(
        state.get("resource_changes", []),
        state.get("environment", "dev"),
    )
    return {
        **mark_node(state, "blast_radius_analyzer"),
        "blast_radius": blast_radius,
    }
