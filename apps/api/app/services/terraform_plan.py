from __future__ import annotations

import re
from copy import deepcopy
from typing import Any


SENSITIVE_KEY_PATTERN = re.compile(
    r"(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth|cert)",
    re.IGNORECASE,
)
REDACTED = "[REDACTED]"
SENSITIVE_ASSIGNMENT_PATTERN = re.compile(
    (
        r"(?P<prefix>(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|"
        r"private[_-]?key|credential|auth|cert)[^:=\n]*[:=]\s*)(?P<value>.+)"
    ),
    re.IGNORECASE,
)
HEREDOC_PATTERN = re.compile(r"<<-?\s*(?P<delimiter>[A-Za-z0-9_.-]+|\"[^\"]+\"|'[^']+')")
PRIVATE_KEY_BLOCK_START_PATTERN = re.compile(r"BEGIN [A-Z ]*PRIVATE KEY", re.IGNORECASE)
PRIVATE_KEY_BLOCK_END_PATTERN = re.compile(r"END [A-Z ]*PRIVATE KEY", re.IGNORECASE)


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


def redact_sensitive_text(value: str) -> str:
    redacted_lines: list[str] = []
    heredoc_end: str | None = None
    redacted_block_open = False
    private_key_block = False
    for line in value.splitlines():
        if heredoc_end:
            if not redacted_block_open:
                redacted_lines.append(_redacted_block_line(line, "HEREDOC CONTENT"))
                redacted_block_open = True
            if _matches_heredoc_end(line, heredoc_end):
                heredoc_end = None
                redacted_block_open = False
            continue

        if private_key_block:
            if not redacted_block_open:
                redacted_lines.append(_redacted_block_line(line, "PRIVATE KEY BLOCK"))
                redacted_block_open = True
            if PRIVATE_KEY_BLOCK_END_PATTERN.search(line):
                private_key_block = False
                redacted_block_open = False
            continue

        assignment = SENSITIVE_ASSIGNMENT_PATTERN.search(line)
        if assignment:
            redacted_lines.append(SENSITIVE_ASSIGNMENT_PATTERN.sub(_redact_assignment_match, line))
            heredoc_end = _heredoc_delimiter(assignment.group("value"))
            continue

        if PRIVATE_KEY_BLOCK_START_PATTERN.search(line):
            redacted_lines.append(_redacted_block_line(line, "PRIVATE KEY BLOCK"))
            private_key_block = True
            redacted_block_open = True
            continue

        redacted_lines.append(line)
    return "\n".join(redacted_lines)


def _redact_assignment_match(match: re.Match[str]) -> str:
    value = match.group("value")
    leading_whitespace = value[: len(value) - len(value.lstrip())]
    body = value.lstrip()
    trailing_whitespace = body[len(body.rstrip()) :]
    stripped = body.rstrip()
    if not stripped:
        return f"{match.group('prefix')}{REDACTED}{trailing_whitespace}"
    if HEREDOC_PATTERN.search(stripped):
        return f"{match.group('prefix')}{leading_whitespace}{REDACTED}{trailing_whitespace}"
    if stripped[0] in {"'", '"'}:
        closing_quote_index = _closing_quote_index(stripped, stripped[0])
        suffix = stripped[closing_quote_index + 1 :] if closing_quote_index is not None else ""
        return f"{match.group('prefix')}{leading_whitespace}{REDACTED}{suffix}{trailing_whitespace}"
    comma_index = stripped.find(",")
    suffix = stripped[comma_index:] if comma_index >= 0 else ""
    return f"{match.group('prefix')}{leading_whitespace}{REDACTED}{suffix}{trailing_whitespace}"


def _closing_quote_index(value: str, quote: str) -> int | None:
    escaped = False
    for index, char in enumerate(value[1:], start=1):
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == quote:
            return index
    return None


def _heredoc_delimiter(value: str) -> str | None:
    match = HEREDOC_PATTERN.search(value)
    if not match:
        return None
    return match.group("delimiter").strip("\"'")


def _matches_heredoc_end(line: str, delimiter: str) -> bool:
    return line.lstrip("+- ").strip() == delimiter


def _redacted_block_line(line: str, label: str) -> str:
    match = re.match(r"^(?P<prefix>[+\- ]?)(?P<indent>\s*)", line)
    if not match:
        return f"[REDACTED {label}]"
    return f"{match.group('prefix')}{match.group('indent')}[REDACTED {label}]"


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
