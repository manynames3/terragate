"""Review assessment and exception validity, independent of comment approval."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from app.models import RunModel, RiskExceptionModel
from app.services.review_approval import review_snapshot_hash


def assessment(run: RunModel) -> str:
    if run.status == "failed":
        return "unavailable"
    return "assessed" if run.completed_at and run.risk_score_detail else "not_assessed"


def policy_version(run: RunModel) -> str | None:
    if not run.policy_snapshot:
        return None
    return hashlib.sha256(json.dumps(run.policy_snapshot, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def rule_revision() -> str:
    nodes = Path(__file__).resolve().parents[1] / "graph/terraform_review/nodes"
    digest = hashlib.sha256()
    for name in ("policy_checks.py", "cost_estimator.py", "blast_radius.py"):
        digest.update(name.encode())
        digest.update((nodes / name).read_bytes())
    digest.update((nodes.parents[2] / "services/terraform_plan.py").read_bytes())
    return digest.hexdigest()


def exception_state(item: RiskExceptionModel, run: RunModel, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    expiry = item.expires_at.replace(tzinfo=timezone.utc) if item.expires_at.tzinfo is None else item.expires_at
    if item.status in {"denied", "revoked"}:
        return item.status
    if expiry <= now:
        return "expired"
    if item.review_hash != review_snapshot_hash(run):
        return "stale"
    return item.status


def policy_decision(run: RunModel, exceptions: list[RiskExceptionModel]) -> dict:
    state = assessment(run)
    if state != "assessed":
        return {"policy_decision": state, "blocking_findings": 0, "accepted_findings": 0}
    accepted = {item.finding_id for item in exceptions if exception_state(item, run) == "approved"}
    blockers = [f for f in run.findings if f.severity in {"critical", "high"} or f.confidence < 0.7 or f.requires_human_review or not f.evidence]
    waived = sum(f.id in accepted for f in blockers)
    remaining = len(blockers) - waived
    return {"policy_decision": "blocked" if remaining else "accepted_risk" if accepted else "passed",
            "blocking_findings": remaining, "accepted_findings": len(accepted)}
