from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.graph.terraform_review.nodes.common import make_evidence, mark_node


PATCH_EXCERPT_LINES = 32


def map_github_pr_context(state: dict[str, Any]) -> dict[str, Any]:
    findings = [deepcopy(finding) for finding in state.get("merged_findings", [])]
    github_context = (state.get("repo_context") or {}).get("github_pr_context") or {}
    terraform_files = github_context.get("terraform_files") or []
    if not terraform_files:
        return {**mark_node(state, "map_github_pr_context"), "merged_findings": findings}

    for finding in findings:
        matched_file = _best_matching_file(finding, terraform_files)
        if not matched_file:
            continue

        patch_excerpt = _patch_excerpt(matched_file.get("patch"), finding)
        finding["pr_file_path"] = matched_file.get("filename")
        finding["pr_file_url"] = matched_file.get("blob_url") or matched_file.get("raw_url")
        finding["pr_patch"] = patch_excerpt
        finding.setdefault("evidence", []).append(
            make_evidence(
                "$.repo_context.github_pr_context.terraform_files",
                {
                    "filename": matched_file.get("filename"),
                    "status": matched_file.get("status"),
                    "patch_excerpt": patch_excerpt,
                },
                "Terraform finding should be traceable to the changed PR file.",
                "GITHUB-PR-CONTEXT",
                "Finding mapped to a changed Terraform file from GitHub PR context.",
            )
        )

    return {**mark_node(state, "map_github_pr_context"), "merged_findings": findings}


def _best_matching_file(
    finding: dict[str, Any], terraform_files: list[dict[str, Any]]
) -> dict[str, Any] | None:
    best_file: dict[str, Any] | None = None
    best_score = 0
    for file in terraform_files:
        score = _match_score(finding, file)
        if score > best_score:
            best_file = file
            best_score = score

    if best_file:
        return best_file
    if len(terraform_files) == 1:
        return terraform_files[0]
    return None


def _match_score(finding: dict[str, Any], file: dict[str, Any]) -> int:
    patch = (file.get("patch") or "").lower()
    filename = (file.get("filename") or "").lower()
    address = (finding.get("resource_address") or "").lower()
    resource_type = (finding.get("resource_type") or "").lower()
    resource_name = _resource_name(address)
    score = 0

    if address and address in patch:
        score += 100
    if resource_type and resource_name and f'resource "{resource_type}" "{resource_name}"' in patch:
        score += 90
    if resource_type and resource_type in patch:
        score += 35
    if resource_name and resource_name in patch:
        score += 20
    if resource_type and resource_type.replace("aws_", "") in filename:
        score += 10
    if resource_name and resource_name in filename:
        score += 8
    return score


def _patch_excerpt(patch: str | None, finding: dict[str, Any]) -> str | None:
    if not patch:
        return None

    lines = patch.splitlines()
    tokens = [
        str(token).lower()
        for token in (
            finding.get("resource_address"),
            finding.get("resource_type"),
            _resource_name(finding.get("resource_address") or ""),
        )
        if token and len(str(token)) > 2
    ]
    match_indexes = [
        index
        for index, line in enumerate(lines)
        if any(token in line.lower() for token in tokens)
    ]
    if not match_indexes:
        return "\n".join(lines[:PATCH_EXCERPT_LINES])

    start = max(0, min(match_indexes) - 6)
    end = min(len(lines), max(match_indexes) + 18)
    excerpt = lines[start:end]
    if start > 0:
        excerpt.insert(0, "... [earlier patch context omitted]")
    if end < len(lines):
        excerpt.append("... [later patch context omitted]")
    return "\n".join(excerpt)


def _resource_name(address: str) -> str:
    if not address:
        return ""
    return address.split("[", 1)[0].split(".")[-1].lower()
