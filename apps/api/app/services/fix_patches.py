from __future__ import annotations

from typing import Any


def suggested_fix_patches(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    patches: list[dict[str, Any]] = []
    for finding in findings:
        remediation = finding.get("remediation")
        if not remediation:
            continue
        path = finding.get("pr_file_path") or _fallback_path(finding)
        diff = _diff_for(path, finding, remediation)
        patches.append(
            {
                "finding_id": finding.get("id"),
                "pr_file_path": path,
                "summary": f"{finding.get('title')}: {remediation.get('explanation', '')}",
                "diff": diff,
            }
        )
    return patches


def _fallback_path(finding: dict[str, Any]) -> str:
    resource_type = finding.get("resource_type") or "terraform"
    return f"suggested-fixes/{resource_type}.tf"


def _diff_for(path: str, finding: dict[str, Any], remediation: dict[str, Any]) -> str:
    snippet = remediation.get("snippet", "").rstrip()
    title = finding.get("title", "TerraGate suggested fix")
    resource = finding.get("resource_address") or "unknown resource"
    patch_context = _patch_context(finding.get("pr_patch"))
    added = "\n".join(f"+{line}" if line else "+" for line in snippet.splitlines())
    lines = [
        f"diff --git a/{path} b/{path}",
        f"--- a/{path}",
        f"+++ b/{path}",
        "@@",
    ]
    if patch_context:
        lines.extend(patch_context)
    lines.extend(
        [
            f"+# TerraGate suggested fix: {title}",
            f"+# Resource: {resource}",
            added,
            "",
        ]
    )
    return "\n".join(lines)


def _patch_context(patch: str | None) -> list[str]:
    if not patch:
        return []
    context: list[str] = []
    for line in patch.splitlines():
        if line.startswith("@@"):
            continue
        if line.startswith("+") and not line.startswith("+++"):
            context.append(" " + line[1:])
        elif line.startswith(" ") or line.startswith("-"):
            context.append(line)
        if len(context) >= 8:
            break
    if not context:
        return []
    return [" # Existing changed-file context from PR patch:"] + context
