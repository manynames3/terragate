from typing import Any

from app.graph.terraform_review.nodes.common import make_evidence, make_finding, mark_node
from app.services.cost_estimator import estimate_cost_delta
from app.services.policy_packs import load_policy_pack


def estimate_cost_delta_node(state: dict[str, Any]) -> dict[str, Any]:
    policy_pack = load_policy_pack(state.get("policy_profile", "default"))
    estimate = estimate_cost_delta(
        state.get("resource_changes", []),
        policy_pack,
        plan_path=state.get("raw_plan_ref"),
    )
    findings = list(state.get("deterministic_results", []))
    if estimate["over_threshold"]:
        findings.append(
            make_finding(
                title="Estimated monthly cost delta exceeds policy threshold",
                description="The Terraform plan appears likely to increase recurring monthly cloud spend beyond the selected policy pack threshold.",
                severity="high",
                category="cost",
                resource={"address": "terraform_plan", "type": "cost_delta", "change": {"actions": ["create"]}},
                evidence=[
                    make_evidence(
                        "$.cost_estimate.monthly_delta",
                        estimate["monthly_delta"],
                        f"<= {estimate['threshold']}",
                        "COST-DELTA-001",
                        "Cost delta is estimated from changed resources and should be confirmed with Infracost in production.",
                    )
                ],
                impact="Unexpected recurring spend can ship without finance or platform approval.",
                recommendation="Review the top cost drivers, resize resources, or approve a budget exception before merge.",
                requires_human_review=True,
            )
        )
    return {
        **mark_node(state, "estimate_cost_delta"),
        "cost_estimate": estimate,
        "deterministic_results": findings,
    }
