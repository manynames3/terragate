from collections import Counter
from typing import Any


SEVERITY_POINTS = {
    "critical": 40,
    "high": 25,
    "medium": 10,
    "low": 3,
    "info": 1,
}
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


def score_risk(findings: list[dict[str, Any]], environment: str) -> dict[str, Any]:
    score = 0
    drivers: list[str] = []
    for finding in findings:
        severity = finding.get("severity", "info")
        score += SEVERITY_POINTS.get(severity, 1)
        resource_type = finding.get("resource_type") or ""
        actions = finding.get("change_actions") or []
        title = finding.get("title", "")
        if "delete" in actions and resource_type in STATEFUL_TYPES:
            score += 15
            drivers.append(f"Stateful destructive action: {finding.get('resource_address')}")
        if "public" in title.lower() or "0.0.0.0/0" in str(finding.get("evidence", "")):
            score += 20
            drivers.append(f"Public exposure: {finding.get('resource_address')}")
        if finding.get("confidence", 1.0) < 0.7:
            finding["requires_human_review"] = True
        if len(drivers) < 5:
            drivers.append(f"{severity.title()}: {title}")

    if environment == "prod":
        score = int(score * 1.5)

    if score >= 80:
        level = "critical"
    elif score >= 50:
        level = "high"
    elif score >= 20:
        level = "medium"
    else:
        level = "low"

    counts = severity_counts(findings)
    summary = (
        f"{counts['critical']} critical, {counts['high']} high, {counts['medium']} medium, "
        f"{counts['low']} low findings across {len(findings)} total issues."
    )
    if not findings:
        summary = "No material policy risks were detected in this Terraform plan."

    return {
        "overall_score": min(score, 100),
        "risk_level": level,
        "summary": summary,
        "top_drivers": list(dict.fromkeys(drivers))[:5],
    }
