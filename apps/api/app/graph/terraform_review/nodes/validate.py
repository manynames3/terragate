from pathlib import Path
from typing import Any

from app.graph.terraform_review.nodes.common import mark_node
from app.integrations.storage import FileSystemArtifactStore
from app.services.terraform_plan import (
    collect_sensitive_paths,
    redacted_plan_with_changes,
    validate_terraform_plan,
)


def validate_and_redact(state: dict[str, Any]) -> dict[str, Any]:
    raw_plan = state["raw_plan"]
    validate_terraform_plan(raw_plan)
    redacted = redacted_plan_with_changes(raw_plan)
    sensitive_paths = [
        {
            "json_path": path,
            "observed_value": "[REDACTED]",
            "explanation": "Sensitive-looking Terraform value was redacted before any AI review.",
        }
        for path, _value in collect_sensitive_paths(raw_plan)
    ]
    store = FileSystemArtifactStore(Path(state["artifact_storage_dir"]))
    redacted_uri, redacted_sha = store.write_json(state["run_id"], "tfplan.redacted.json", redacted)
    return {
        **mark_node(state, "validate_and_redact"),
        "redacted_plan": redacted,
        "redacted_plan_ref": redacted_uri,
        "redacted_plan_sha256": redacted_sha,
        "sensitive_paths": sensitive_paths,
    }
