import json
from pathlib import Path

from app.services.terraform_plan import (
    extract_resource_changes,
    redacted_plan_with_changes,
    summarize_plan,
)


ROOT = Path(__file__).resolve().parents[4]


def load_plan(name: str) -> dict:
    return json.loads((ROOT / "sample-data" / "terraform-plans" / name).read_text())


def test_parser_extracts_resource_changes_and_summary() -> None:
    plan = load_plan("risky-security-plan.json")
    changes = extract_resource_changes(plan)
    summary = summarize_plan(changes)

    assert len(changes) == 3
    assert changes[0]["address"] == "aws_security_group.web"
    assert summary["creates"] == 3
    assert summary["resource_types_affected"]["aws_db_instance"] == 1


def test_redaction_removes_sensitive_values() -> None:
    plan = load_plan("risky-security-plan.json")
    redacted = redacted_plan_with_changes(plan)

    db_after = redacted["resource_changes"][1]["change"]["after"]
    assert db_after["master_password"] == "[REDACTED]"
