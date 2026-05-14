import json
from pathlib import Path

from app.graph.terraform_review.nodes.policy_checks import run_policy_checks
from app.services.terraform_plan import extract_resource_changes, redacted_plan_with_changes


ROOT = Path(__file__).resolve().parents[4]


def load_changes(name: str):
    plan = redacted_plan_with_changes(
        json.loads((ROOT / "sample-data" / "terraform-plans" / name).read_text())
    )
    return extract_resource_changes(plan)


def test_safe_plan_has_no_policy_findings() -> None:
    findings = run_policy_checks(
        load_changes("safe-plan.json"),
        environment="dev",
        policy_profile="default",
        sensitive_paths=[],
    )

    assert findings == []


def test_security_plan_flags_public_ingress_rds_and_iam() -> None:
    findings = run_policy_checks(
        load_changes("risky-security-plan.json"),
        environment="prod",
        policy_profile="default",
        sensitive_paths=[],
    )
    titles = {finding["title"] for finding in findings}

    assert "Public ingress exposes sensitive service" in titles
    assert "RDS instance is publicly accessible" in titles
    assert "RDS storage encryption disabled" in titles
    assert "IAM policy uses wildcard permissions" in titles


def test_cost_plan_flags_large_resources_and_missing_tags() -> None:
    findings = run_policy_checks(
        load_changes("risky-cost-plan.json"),
        environment="dev",
        policy_profile="default",
        sensitive_paths=[],
    )
    titles = {finding["title"] for finding in findings}

    assert "Large EC2 instance in non-production" in titles
    assert "NAT Gateway creation adds recurring network cost" in titles
    assert "Large EBS volume provisioned" in titles
    assert "High provisioned EBS IOPS" in titles
    assert "Missing cost_center tag" in titles
