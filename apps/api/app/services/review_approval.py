from __future__ import annotations

import hashlib
import json

from app.models import FixPatchModel, RunModel


DECISION_STATES = {"approval_pending", "approved", "rejected"}
POSTED_STATES = {"comment_posted", "mock_comment_ready"}


def review_snapshot_hash(run: RunModel) -> str:
    # Exclude mutable workflow status, timestamps and audit records from approval identity.
    payload = {
        "schema": 1,
        "run_id": run.id,
        "environment": run.environment,
        "cloud_provider": run.cloud_provider,
        "policy_profile": run.policy_profile,
        "policy_snapshot": run.policy_snapshot,
        "repository": [run.repo_owner, run.repo_name, run.pull_number, run.reviewed_head_sha],
        "artifacts": sorted((a.type, a.sha256, a.redacted) for a in run.artifacts),
        "report": run.report_markdown,
        "draft": run.pr_comment_draft,
        "remediation": run.remediation_summary,
        "risk": [run.risk_score, run.risk_level, run.risk_score_detail],
        "plan_summary": run.plan_summary,
        "cost": run.cost_estimate,
        "blast_radius": run.blast_radius,
        "findings": [
            {
                "id": f.id, "title": f.title, "description": f.description,
                "severity": f.severity, "category": f.category,
                "resource": [f.resource_address, f.resource_type, f.provider, f.change_actions],
                "impact": f.impact, "recommendation": f.recommendation,
                "compliance": f.compliance_refs, "confidence": f.confidence,
                "source": f.source, "reviewer": f.reviewer_node,
                "human_review": f.requires_human_review,
                "pr_context": [f.pr_file_path, f.pr_file_url, f.pr_patch],
                "runbook": f.runbook_checklist,
                "evidence": sorted(
                    (e.json_path, e.observed_value, e.expected_value or "", e.rule_id or "", e.explanation)
                    for e in f.evidence
                ),
                "remediations": sorted(
                    (r.language, r.snippet, r.explanation, r.risk_of_change) for r in f.remediations
                ),
            }
            for f in sorted(run.findings, key=lambda item: item.id)
        ],
    }
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(serialized.encode()).hexdigest()


def approval_is_current(run: RunModel) -> bool:
    return bool(run.approval_status == "approved" and run.approved_snapshot_hash
                and run.approved_snapshot_hash == review_snapshot_hash(run))


def patch_snapshot_hash(run: RunModel, patch: FixPatchModel) -> str:
    payload = [review_snapshot_hash(run), patch.id, patch.kind, patch.pr_file_path, patch.diff, patch.snippet]
    return hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()


def decision_error(run: RunModel, snapshot_hash: str) -> str | None:
    if run.status not in DECISION_STATES or not run.completed_at or not run.pr_comment_draft.strip():
        return "Only a completed review with a comment draft can receive a decision."
    if not run.policy_snapshot:
        return "This legacy review has no saved policy snapshot. Run a new review before approving."
    if snapshot_hash != review_snapshot_hash(run):
        return "The review changed after you loaded it. Refresh and inspect the current draft before deciding."
    return None
