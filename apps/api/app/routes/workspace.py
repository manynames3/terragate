from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, func, or_, cast, String
from sqlalchemy.orm import Session

from app.auth.dev import DevUser, get_current_user, require_role
from app.config import get_settings
from app.db.session import get_db
from app.models import RunModel, FindingModel, RiskExceptionModel, AuditLogModel
from app.routes.terraform_reviews import _get_run_or_404, _scope_run_query, _run_detail, _record_audit, _run_load_options
from app.services.review_approval import review_snapshot_hash
from app.services.review_workspace import exception_state, assessment

router = APIRouter(prefix="/api/v1", tags=["review workspace"])


class ExceptionRequest(BaseModel):
    finding_id: str
    review_snapshot_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    justification: str = Field(min_length=20, max_length=2000)
    expires_at: datetime

    @field_validator("justification")
    @classmethod
    def meaningful_reason(cls, value):
        if len(value.strip()) < 20:
            raise ValueError("Provide at least 20 characters of business justification.")
        return value.strip()


class ExceptionDecision(BaseModel):
    decision: Literal["approved", "denied", "revoked"]
    notes: str = Field(min_length=10, max_length=2000)

    @field_validator("notes")
    @classmethod
    def meaningful_notes(cls, value):
        if len(value.strip()) < 10:
            raise ValueError("Explain the decision in at least 10 characters.")
        return value.strip()


def exception_json(item, run):
    finding = next((f for f in run.findings if f.id == item.finding_id), None)
    return {"id": item.id, "run_id": item.run_id, "finding_id": item.finding_id,
            "finding_title": finding.title if finding else None, "resource_address": finding.resource_address if finding else None,
            "status": exception_state(item, run), "justification": item.justification,
            "expires_at": item.expires_at, "requester_email": item.requester_email,
            "approver_email": item.approver_email, "decision_notes": item.decision_notes,
            "created_at": item.created_at, "decided_at": item.decided_at,
            "review_snapshot_hash": item.review_hash}


@router.get("/reviews")
def reviews(db: Session = Depends(get_db), user: DevUser = Depends(get_current_user),
            q: str = Query(default="", max_length=200), status: str = "", environment: str = "",
            repository: str = "", severity: str = "", limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    query = _scope_run_query(select(RunModel), user)
    if q.strip():
        term = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.where(or_(RunModel.id.ilike(term, escape="\\"), RunModel.repo_name.ilike(term, escape="\\"),
            RunModel.repo_owner.ilike(term, escape="\\"), cast(RunModel.pull_number, String).ilike(term, escape="\\"), RunModel.summary.ilike(term, escape="\\"),
            RunModel.findings.any(or_(FindingModel.title.ilike(term, escape="\\"), FindingModel.description.ilike(term, escape="\\"), FindingModel.resource_address.ilike(term, escape="\\")))))
    if status == "attention":
        query = query.where(or_(RunModel.status.in_(["approval_pending", "failed", "rejected", "queued", "running"]),
            RunModel.findings.any(or_(FindingModel.severity.in_(["critical", "high"]), FindingModel.confidence < 0.7,
                                     FindingModel.requires_human_review.is_(True), ~FindingModel.evidence.any()))))
    elif status and status != "all":
        query = query.where(RunModel.status == status)
    if environment:
        query = query.where(RunModel.environment == environment)
    if repository:
        owner, _, name = repository.partition("/")
        query = query.where(RunModel.repo_owner == owner, RunModel.repo_name == name)
    if severity:
        query = query.where(RunModel.findings.any(FindingModel.severity == severity))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.options(*_run_load_options()).order_by(RunModel.created_at.desc(), RunModel.id.desc()).limit(limit).offset(offset)).all()
    by_run = {run.id: [] for run in rows}
    for item in db.scalars(select(RiskExceptionModel).where(RiskExceptionModel.run_id.in_(by_run))):
        by_run[item.run_id].append(item)
    return {"items": [_run_detail(run, by_run[run.id]) for run in rows], "total": total, "offset": offset, "limit": limit}


@router.get("/repositories")
def repositories(db: Session = Depends(get_db), user: DevUser = Depends(get_current_user)):
    rows = db.execute(_scope_run_query(select(RunModel.repo_owner, RunModel.repo_name, func.count(RunModel.id), func.max(RunModel.created_at)), user)
        .where(RunModel.repo_owner.is_not(None), RunModel.repo_name.is_not(None))
        .group_by(RunModel.repo_owner, RunModel.repo_name).order_by(RunModel.repo_owner, RunModel.repo_name)).all()
    return [{"full_name": f"{owner}/{name}", "review_count": count, "last_review_at": last,
             "connection": "observed_only", "merge_enforcement": "not_verified"} for owner, name, count, last in rows]


@router.get("/audit-log")
def audit_log(db: Session = Depends(get_db), user: DevUser = Depends(get_current_user), limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    ids = _scope_run_query(select(RunModel.id), user)
    query = select(AuditLogModel).where(AuditLogModel.run_id.in_(ids))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    events = db.scalars(query.order_by(AuditLogModel.created_at.desc(), AuditLogModel.id.desc()).limit(limit).offset(offset)).all()
    return {"items": [{"id": e.id, "run_id": e.run_id, "action": e.action, "actor_email": e.actor_email,
                       "target_type": e.target_type, "target_id": e.target_id, "metadata": e.metadata_json, "created_at": e.created_at} for e in events], "total": total}


@router.get("/exceptions")
def exceptions(db: Session = Depends(get_db), user: DevUser = Depends(get_current_user), run_id: str | None = None,
               finding_id: str | None = Query(default=None, max_length=32),
               limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    if run_id:
        _get_run_or_404(db, run_id, user=user)
    query = select(RiskExceptionModel).where(RiskExceptionModel.run_id.in_(_scope_run_query(select(RunModel.id), user)))
    if run_id:
        query = query.where(RiskExceptionModel.run_id == run_id)
    if finding_id:
        query = query.where(RiskExceptionModel.finding_id == finding_id)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(RiskExceptionModel.created_at.desc(), RiskExceptionModel.id.desc()).limit(limit).offset(offset)).all()
    runs = {run.id: run for run in db.scalars(select(RunModel).where(RunModel.id.in_({item.run_id for item in rows})).options(*_run_load_options()))}
    return {"items": [exception_json(item, runs[item.run_id]) for item in rows], "total": total}


@router.post("/runs/{run_id}/exceptions")
def request_exception(run_id: str, payload: ExceptionRequest, db: Session = Depends(get_db), user: DevUser = Depends(get_current_user)):
    require_role(user, {"reviewer", "platform-admin"})
    run = _get_run_or_404(db, run_id, user=user, lock=True)
    if assessment(run) != "assessed" or payload.review_snapshot_hash != review_snapshot_hash(run):
        raise HTTPException(status_code=409, detail="Refresh a completed review before requesting an exception.")
    if not run.policy_snapshot:
        raise HTTPException(status_code=409, detail="Re-review this legacy plan to capture policy provenance.")
    if not any(f.id == payload.finding_id for f in run.findings):
        raise HTTPException(status_code=404, detail="Finding not found in this review.")
    now = datetime.now(timezone.utc)
    if payload.expires_at.tzinfo is None or not now < payload.expires_at <= now + timedelta(days=90):
        raise HTTPException(status_code=422, detail="Expiration must include a timezone and be within the next 90 days.")
    existing = db.scalars(select(RiskExceptionModel).where(RiskExceptionModel.run_id == run_id, RiskExceptionModel.finding_id == payload.finding_id)).all()
    if any(exception_state(item, run) in {"pending", "approved"} for item in existing):
        raise HTTPException(status_code=409, detail="This finding already has a current pending or approved exception.")
    item = RiskExceptionModel(run_id=run_id, finding_id=payload.finding_id, review_hash=payload.review_snapshot_hash,
        justification=payload.justification, expires_at=payload.expires_at, requested_by=user.id, requester_email=user.email)
    db.add(item)
    db.flush()
    _record_audit(db, action="exception.requested", run_id=run_id, actor=user, target_type="exception", target_id=item.id,
                  metadata={"finding_id": item.finding_id, "review_snapshot_hash": item.review_hash, "expires_at": item.expires_at.isoformat()})
    db.commit()
    return exception_json(item, run)


@router.post("/exceptions/{exception_id}/decision")
def decide_exception(exception_id: str, payload: ExceptionDecision, db: Session = Depends(get_db), user: DevUser = Depends(get_current_user)):
    require_role(user, {"platform-admin"})
    item = db.get(RiskExceptionModel, exception_id)
    if not item:
        raise HTTPException(status_code=404, detail="Exception not found.")
    run = _get_run_or_404(db, item.run_id, user=user, lock=True)
    db.refresh(item)
    if item.requested_by == user.id:
        raise HTTPException(status_code=403, detail="A different administrator must decide this exception.")
    required = "approved" if payload.decision == "revoked" else "pending"
    if exception_state(item, run) != required:
        raise HTTPException(status_code=409, detail="This exception is no longer eligible for that decision. Refresh its history.")
    item.status = payload.decision
    item.decided_by, item.approver_email = user.id, user.email
    item.decision_notes, item.decided_at = payload.notes, datetime.now(timezone.utc)
    _record_audit(db, action=f"exception.{payload.decision}", run_id=run.id, actor=user, target_type="exception", target_id=item.id,
                  metadata={"finding_id": item.finding_id, "notes": payload.notes, "review_snapshot_hash": item.review_hash})
    db.commit()
    return exception_json(item, run)


@router.get("/runs/{run_id}/plan")
def redacted_plan(run_id: str, db: Session = Depends(get_db), user: DevUser = Depends(get_current_user),
                  limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0), resource: str | None = Query(default=None, max_length=512)):
    run = _get_run_or_404(db, run_id, user=user)
    artifact = next((a for a in run.artifacts if a.type == "terraform_plan_redacted" and a.redacted), None)
    if not artifact:
        raise HTTPException(status_code=409, detail="Redacted plan is not available. Wait for review completion.")
    path = Path(artifact.storage_uri).resolve()
    if not path.is_relative_to(get_settings().artifact_root.resolve()):
        raise HTTPException(status_code=403, detail="Artifact is outside the configured store.")
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        raise HTTPException(status_code=410, detail="This plan artifact has expired from local storage. Upload a new plan to re-review.")
    if sha256(data).hexdigest() != artifact.sha256:
        raise HTTPException(status_code=409, detail="Plan artifact integrity check failed. Re-review the original plan.")
    import json
    changes = json.loads(data).get("resource_changes", [])
    if resource:
        changes = [c for c in changes if c.get("address") == resource]
    return {"items": [{"address": c.get("address"), "type": c.get("type"), "change": c.get("change", {})} for c in changes[offset:offset+limit]],
            "total": len(changes), "redacted": True, "sha256": artifact.sha256}
