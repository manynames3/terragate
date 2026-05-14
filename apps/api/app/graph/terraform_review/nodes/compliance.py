from typing import Any

from app.graph.terraform_review.nodes.common import mark_node


def compliance_mapper(state: dict[str, Any]) -> dict[str, Any]:
    mappings: dict[str, list[str]] = {}
    updated = []
    for finding in state.get("merged_findings", []):
        refs = _refs_for(finding)
        mappings[finding["id"]] = refs
        updated.append({**finding, "compliance_refs": refs})
    return {
        **mark_node(state, "compliance_mapper"),
        "merged_findings": updated,
        "compliance_mappings": mappings,
    }


def _refs_for(finding: dict[str, Any]) -> list[str]:
    title = finding.get("title", "").lower()
    category = finding.get("category")
    refs: list[str] = []
    if "public ingress" in title:
        refs.extend(["CIS AWS Foundations 5.2", "NIST AC-4", "NIST SC-7"])
    if "rds" in title and "public" in title:
        refs.extend(["CIS AWS Foundations 2.3.3", "NIST SC-7"])
    if "encryption" in title:
        refs.extend(["CIS AWS Foundations 2.1", "NIST SC-28"])
    if "wildcard" in title:
        refs.extend(["CIS AWS Foundations 1.16", "NIST AC-6"])
    if "backup" in title or "deletion protection" in title:
        refs.extend(["NIST CP-9", "NIST CP-10"])
    if category == "governance" or "tag" in title:
        refs.extend(["NIST CM-8", "NIST PM-5"])
    if not refs:
        refs.append("Internal TerraGate Policy")
    return list(dict.fromkeys(refs))
