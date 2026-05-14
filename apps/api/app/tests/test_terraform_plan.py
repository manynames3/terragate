import json
from pathlib import Path

from app.services.terraform_plan import (
    extract_resource_changes,
    redacted_plan_with_changes,
    redact_sensitive_text,
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


def test_text_redaction_removes_patch_assignments_and_json_values() -> None:
    patch = "\n".join(
        [
            '+  password = "super-secret"',
            '+  config = { "api_key": "abc123", "safe": "value" }',
            '+  token: bearer-value',
        ]
    )

    redacted = redact_sensitive_text(patch)

    assert "super-secret" not in redacted
    assert "abc123" not in redacted
    assert "bearer-value" not in redacted
    assert "[REDACTED]" in redacted
    assert '"safe": "value"' in redacted


def test_text_redaction_removes_sensitive_heredoc_and_private_key_blocks() -> None:
    patch = "\n".join(
        [
            "+  private_key = <<EOT",
            "+  -----BEGIN PRIVATE KEY-----",
            "+  raw-key-material",
            "+  -----END PRIVATE KEY-----",
            "+  EOT",
            "+  certificate_body = <<EOF",
            "+  certificate-secret",
            "+  EOF",
        ]
    )

    redacted = redact_sensitive_text(patch)

    assert "raw-key-material" not in redacted
    assert "certificate-secret" not in redacted
    assert "BEGIN PRIVATE KEY" not in redacted
    assert "[REDACTED]" in redacted
    assert "[REDACTED HEREDOC CONTENT]" in redacted
