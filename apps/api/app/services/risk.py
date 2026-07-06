from collections import Counter
from typing import Any


STATEFUL_TYPES = (
    "aws_db_instance",
    "aws_ebs_volume",
    "aws_efs_file_system",
    "aws_dynamodb_table",
    "aws_s3_bucket",
)


def severity_counts(findings: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(finding.get("severity", "info") for finding in findings)
    return {severity: counts.get(severity, 0) for severity in ["critical", "high", "medium", "low", "info"]}


def score_risk(
    findings: list[dict[str, Any]],
    environment: str,
    cost_estimate: dict[str, Any] | None = None,
    blast_radius: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a bounded, explainable risk score.

    Raw additive severity scoring made different high-risk reviews collapse to
    100/100. This model keeps the score interpretable by capping the severity
    component and adding bounded bonuses for production exposure, public access,
    cost threshold breaches, and destructive stateful blast radius.
    """
    counts = severity_counts(findings)
    if not findings:
        return {
            "overall_score": 0,
            "risk_level": "low",
            "summary": "No material policy risks were detected in this Terraform plan.",
            "top_drivers": [],
        }

    drivers: list[str] = []
    has_public_exposure = False
    for finding in findings:
        severity = finding.get("severity", "info")
        title = finding.get("title", "")
        if _is_public_exposure(finding):
            has_public_exposure = True
            drivers.append(f"Public exposure: {finding.get('resource_address')}")
        if finding.get("confidence", 1.0) < 0.7:
            finding["requires_human_review"] = True
        if len(drivers) < 5:
            drivers.append(f"{severity.title()}: {title}")

    severity_component = min(
        55,
        counts["critical"] * 18
        + counts["high"] * 8
        + counts["medium"] * 3
        + counts["low"],
    )
    stateful_changes = _stateful_changes(findings, blast_radius)
    critical_stateful = sum(1 for item in stateful_changes if item.get("severity") == "critical")
    stateful_bonus = min(25, len(stateful_changes) * 12 + critical_stateful * 5)
    if stateful_changes:
        drivers.append(f"Stateful destructive action: {len(stateful_changes)} resource(s)")

    monthly_delta = _float((cost_estimate or {}).get("monthly_delta"))
    threshold = _float((cost_estimate or {}).get("threshold"), default=500.0)
    cost_bonus = (
        24
        if monthly_delta > threshold and _has_cost_threshold_finding(findings)
        else 8
        if monthly_delta > 0
        else 0
    )
    if cost_bonus:
        drivers.append(f"Monthly cost delta: ${monthly_delta:,.0f}")

    exposure_bonus = 26 if has_public_exposure else 0
    prod_bonus = 8 if environment == "prod" else 0
    score = min(
        100,
        round(severity_component + stateful_bonus + cost_bonus + exposure_bonus + prod_bonus),
    )

    if score >= 80:
        level = "critical"
    elif score >= 50:
        level = "high"
    elif score >= 20:
        level = "medium"
    else:
        level = "low"

    summary = (
        f"{counts['critical']} critical, {counts['high']} high, {counts['medium']} medium, "
        f"{counts['low']} low findings across {len(findings)} total issues."
    )

    return {
        "overall_score": score,
        "risk_level": level,
        "summary": summary,
        "top_drivers": list(dict.fromkeys(drivers))[:5],
    }


def _stateful_changes(
    findings: list[dict[str, Any]],
    blast_radius: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    from_blast_radius = list((blast_radius or {}).get("stateful_changes") or [])
    if from_blast_radius:
        return from_blast_radius
    changes: list[dict[str, Any]] = []
    for finding in findings:
        resource_type = finding.get("resource_type") or ""
        actions = finding.get("change_actions") or []
        if "delete" in actions and resource_type in STATEFUL_TYPES:
            changes.append(
                {
                    "resource_address": finding.get("resource_address"),
                    "resource_type": resource_type,
                    "severity": finding.get("severity"),
                }
            )
    return changes


def _is_public_exposure(finding: dict[str, Any]) -> bool:
    title_and_description = " ".join(
        [
            str(finding.get("title", "")),
            str(finding.get("description", "")),
        ]
    ).lower()
    explicit_public_signals = (
        "public ingress",
        "publicly accessible",
        "public network access",
        "public internet",
        "public access block disabled",
        "public access block not visible",
    )
    if any(signal in title_and_description for signal in explicit_public_signals):
        return True

    for evidence in finding.get("evidence") or []:
        observed = str(evidence.get("observed_value", "")).lower()
        json_path = str(evidence.get("json_path", "")).lower()
        if "0.0.0.0/0" in observed or "::/0" in observed:
            return True
        if "publicly_accessible" in json_path and observed == "true":
            return True
    return False


def _has_cost_threshold_finding(findings: list[dict[str, Any]]) -> bool:
    return any(
        finding.get("category") == "cost"
        and "cost delta" in str(finding.get("title", "")).lower()
        for finding in findings
    )


def _float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
