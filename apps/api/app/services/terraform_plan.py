from __future__ import annotations

import re
from copy import deepcopy
from typing import Any


SENSITIVE_KEY_PATTERN = re.compile(
    r"(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth|cert)",
    re.IGNORECASE,
)
REDACTED = "[REDACTED]"


class TerraformPlanError(ValueError):
    pass


def validate_terraform_plan(plan: dict[str, Any]) -> None:
    if not isinstance(plan, dict):
        raise TerraformPlanError("Terraform plan JSON must be an object.")
    if "resource_changes" not in plan or not isinstance(plan["resource_changes"], list):
        raise TerraformPlanError(
            "Terraform plan JSON must include a resource_changes array. Generate it with terraform show -json."
        )


def redact_sensitive_values(value: Any, path: str = "$") -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if SENSITIVE_KEY_PATTERN.search(str(key)):
                redacted[key] = REDACTED
            else:
                redacted[key] = redact_sensitive_values(child, child_path)
        return redacted
    if isinstance(value, list):
        return [redact_sensitive_values(item, f"{path}[{index}]") for index, item in enumerate(value)]
    return value


def collect_sensitive_paths(value: Any, path: str = "$") -> list[tuple[str, Any]]:
    matches: list[tuple[str, Any]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if SENSITIVE_KEY_PATTERN.search(str(key)):
                matches.append((child_path, child))
            else:
                matches.extend(collect_sensitive_paths(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            matches.extend(collect_sensitive_paths(child, f"{path}[{index}]"))
    return matches


def extract_resource_changes(plan: dict[str, Any]) -> list[dict[str, Any]]:
    validate_terraform_plan(plan)
    changes: list[dict[str, Any]] = []
    for index, resource in enumerate(plan.get("resource_changes", [])):
        change = resource.get("change") or {}
        after = change.get("after") if isinstance(change.get("after"), dict) else {}
        before = change.get("before") if isinstance(change.get("before"), dict) else {}
        actions = change.get("actions") or []
        provider_name = resource.get("provider_name") or infer_provider(resource.get("type", ""))
        changes.append(
            {
                "index": index,
                "address": resource.get("address"),
                "mode": resource.get("mode"),
                "type": resource.get("type"),
                "name": resource.get("name"),
                "provider_name": provider_name,
                "change": {
                    "actions": actions,
                    "before": before,
                    "after": after,
                    "after_unknown": change.get("after_unknown") or {},
                },
            }
        )
    return changes


def infer_provider(resource_type: str | None) -> str:
    if not resource_type:
        return "unknown"
    if resource_type.startswith("aws_"):
        return "registry.terraform.io/hashicorp/aws"
    if resource_type.startswith("azurerm_"):
        return "registry.terraform.io/hashicorp/azurerm"
    if resource_type.startswith("google_"):
        return "registry.terraform.io/hashicorp/google"
    return "unknown"


def summarize_plan(resource_changes: list[dict[str, Any]]) -> dict[str, Any]:
    summary = {
        "total_resource_changes": len(resource_changes),
        "creates": 0,
        "updates": 0,
        "deletes": 0,
        "replacements": 0,
        "no_ops": 0,
        "resource_types_affected": {},
        "providers_affected": {},
    }
    for resource in resource_changes:
        actions = resource.get("change", {}).get("actions", [])
        resource_type = resource.get("type") or "unknown"
        provider = resource.get("provider_name") or "unknown"
        summary["resource_types_affected"][resource_type] = (
            summary["resource_types_affected"].get(resource_type, 0) + 1
        )
        summary["providers_affected"][provider] = summary["providers_affected"].get(provider, 0) + 1
        if actions == ["no-op"]:
            summary["no_ops"] += 1
        if "create" in actions and "delete" in actions:
            summary["replacements"] += 1
        elif "create" in actions:
            summary["creates"] += 1
        elif "update" in actions:
            summary["updates"] += 1
        elif "delete" in actions:
            summary["deletes"] += 1
    return summary


def redacted_plan_with_changes(plan: dict[str, Any]) -> dict[str, Any]:
    safe_plan = redact_sensitive_values(deepcopy(plan))
    validate_terraform_plan(safe_plan)
    return safe_plan


def get_attr(resource_change: dict[str, Any], key: str, prefer_after: bool = True) -> Any:
    change = resource_change.get("change", {})
    scopes = ("after", "before") if prefer_after else ("before", "after")
    for scope in scopes:
        value = (change.get(scope) or {}).get(key)
        if value is not None:
            return value
    return None


def get_tags(resource_change: dict[str, Any]) -> dict[str, str]:
    tags = get_attr(resource_change, "tags") or get_attr(resource_change, "tags_all") or {}
    return tags if isinstance(tags, dict) else {}


def is_create_or_update(resource_change: dict[str, Any]) -> bool:
    actions = resource_change.get("change", {}).get("actions", [])
    return "create" in actions or "update" in actions


def is_delete_or_replace(resource_change: dict[str, Any]) -> bool:
    actions = resource_change.get("change", {}).get("actions", [])
    return "delete" in actions
