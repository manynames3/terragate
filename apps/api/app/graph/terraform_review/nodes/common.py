from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def mark_node(state: dict[str, Any], name: str, status: str = "completed") -> dict[str, Any]:
    progress = list(state.get("graph_progress", []))
    progress.append(
        {
            "node": name,
            "status": status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )
    return {"graph_progress": progress}


def finding_id() -> str:
    return f"fnd_{uuid4().hex[:18]}"


def make_evidence(
    json_path: str,
    observed_value: Any,
    expected_value: Any | None,
    rule_id: str,
    explanation: str,
    source_artifact: str | None = None,
) -> dict[str, Any]:
    return {
        "source_artifact": source_artifact,
        "json_path": json_path,
        "observed_value": observed_value,
        "expected_value": expected_value,
        "rule_id": rule_id,
        "explanation": explanation,
    }


def make_finding(
    *,
    title: str,
    description: str,
    severity: str,
    category: str,
    resource: dict[str, Any],
    evidence: list[dict[str, Any]],
    impact: str,
    recommendation: str,
    confidence: float = 0.95,
    reviewer_node: str = "deterministic_policy_checks",
    source: str = "deterministic_rule",
    requires_human_review: bool = False,
) -> dict[str, Any]:
    return {
        "id": finding_id(),
        "title": title,
        "description": description,
        "severity": severity,
        "category": category,
        "resource_address": resource.get("address"),
        "resource_type": resource.get("type"),
        "provider": resource.get("provider_name"),
        "change_actions": resource.get("change", {}).get("actions", []),
        "evidence": evidence,
        "impact": impact,
        "recommendation": recommendation,
        "remediation": None,
        "compliance_refs": [],
        "confidence": confidence,
        "source": source,
        "reviewer_node": reviewer_node,
        "requires_human_review": requires_human_review or confidence < 0.7,
    }


def resource_json_path(resource: dict[str, Any], suffix: str = "") -> str:
    base = f"$.resource_changes[{resource.get('index', 0)}]"
    return f"{base}.{suffix}" if suffix else base
