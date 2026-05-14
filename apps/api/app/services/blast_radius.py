from __future__ import annotations

from typing import Any

from app.services.terraform_plan import get_attr


STATEFUL_TYPES = {
    "aws_db_instance": "database",
    "aws_ebs_volume": "block storage",
    "aws_efs_file_system": "shared filesystem",
    "aws_dynamodb_table": "NoSQL table",
    "aws_s3_bucket": "object storage",
    "aws_opensearch_domain": "search cluster",
}


def analyze_blast_radius(resource_changes: list[dict[str, Any]], environment: str) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    score = 0
    for resource in resource_changes:
        resource_type = resource.get("type")
        actions = resource.get("change", {}).get("actions", [])
        if resource_type not in STATEFUL_TYPES or "delete" not in actions:
            continue
        factors = _resource_factors(resource, environment)
        severity = _severity(environment, factors)
        score += {"critical": 40, "high": 25, "medium": 10, "low": 3}[severity]
        items.append(
            {
                "resource_address": resource.get("address"),
                "resource_type": resource_type,
                "asset_class": STATEFUL_TYPES[resource_type],
                "actions": actions,
                "severity": severity,
                "factors": factors,
                "dependencies": _dependencies(resource),
                "replacement_risk": _replacement_risk(resource, environment, factors),
                "backup_status": _backup_status(resource),
                "deletion_protection": get_attr(resource, "deletion_protection"),
                "required_runbook": _runbook_steps(resource_type),
                "rollback_checklist": _rollback_checklist(resource_type),
            }
        )
    level = "critical" if score >= 50 else "high" if score >= 25 else "medium" if score else "low"
    return {
        "score": min(score, 100),
        "level": level,
        "stateful_changes": items,
        "summary": _summary(items, level),
    }


def _resource_factors(resource: dict[str, Any], environment: str) -> list[str]:
    factors = [f"environment={environment}"]
    if environment == "prod":
        factors.append("production change")
    if get_attr(resource, "deletion_protection") is False:
        factors.append("deletion protection disabled")
    if get_attr(resource, "backup_retention_period") in {None, 0}:
        factors.append("backup retention missing")
    if get_attr(resource, "multi_az") is False:
        factors.append("single-AZ")
    return factors


def _severity(environment: str, factors: list[str]) -> str:
    if environment == "prod" and ("backup retention missing" in factors or "deletion protection disabled" in factors):
        return "critical"
    if environment == "prod":
        return "high"
    return "medium"


def _runbook_steps(resource_type: str) -> list[str]:
    if resource_type == "aws_db_instance":
        return [
            "Confirm latest snapshot and point-in-time restore window.",
            "Document maintenance window and rollback owner.",
            "Validate restore procedure in non-production before apply.",
            "Confirm application connection cutover and post-apply smoke tests.",
        ]
    return [
        "Confirm backup or export exists.",
        "Identify downstream consumers before apply.",
        "Define rollback and data validation steps.",
    ]


def _dependencies(resource: dict[str, Any]) -> list[dict[str, Any]]:
    keys = [
        "db_subnet_group_name",
        "vpc_security_group_ids",
        "subnet_id",
        "subnet_ids",
        "kms_key_id",
        "snapshot_identifier",
        "replicate_source_db",
        "domain_endpoint_options",
    ]
    dependencies = []
    for key in keys:
        value = get_attr(resource, key)
        if value is not None and value != "" and value != []:
            dependencies.append({"name": key, "value": value})
    return dependencies


def _replacement_risk(resource: dict[str, Any], environment: str, factors: list[str]) -> str:
    if environment == "prod" and "backup retention missing" in factors:
        return "high_data_loss_risk"
    if environment == "prod":
        return "high_outage_risk"
    return "moderate_operational_risk"


def _backup_status(resource: dict[str, Any]) -> str:
    if get_attr(resource, "skip_final_snapshot") is True:
        return "final_snapshot_skipped"
    retention = get_attr(resource, "backup_retention_period")
    if retention in {None, 0}:
        return "backup_not_confirmed"
    return f"automated_backup_retention_{retention}_days"


def _rollback_checklist(resource_type: str) -> list[str]:
    if resource_type == "aws_db_instance":
        return [
            "Restore latest snapshot to a temporary instance.",
            "Validate schema and application connectivity.",
            "Switch application connection string or DNS record back.",
            "Keep failed replacement isolated for forensic review.",
        ]
    return [
        "Restore from backup/export into a temporary resource.",
        "Reattach dependent services after validation.",
        "Compare object/count/checksum or service-specific health signals.",
    ]


def _summary(items: list[dict[str, Any]], level: str) -> str:
    if not items:
        return "No destructive stateful changes detected."
    return f"{len(items)} destructive stateful change(s) detected. Blast radius is {level}."
