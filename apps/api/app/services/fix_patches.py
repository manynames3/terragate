from __future__ import annotations

from typing import Any


def suggested_fix_patches(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Export guidance only; evidence snippets are not patches against reviewed source."""
    patches: list[dict[str, Any]] = []
    for finding in findings:
        remediation = finding.get("remediation")
        if not remediation:
            continue
        path = finding.get("pr_file_path")
        patches.append(
            {
                "finding_id": finding.get("id"),
                "pr_file_path": path,
                "summary": _summary_for(finding, remediation, path or "unmapped source"),
                "kind": "snippet",
                "snippet": remediation.get("snippet", ""),
                "diff": "",
            }
        )
    return patches


def _summary_for(finding: dict[str, Any], remediation: dict[str, Any], path: str) -> str:
    severity = str(finding.get("severity") or "risk").upper()
    resource = finding.get("resource_address") or finding.get("resource_type") or "Terraform resource"
    explanation = remediation.get("explanation") or "Apply the suggested Terraform remediation."
    return f"{severity} fix for {resource} in {path}: {explanation}"
