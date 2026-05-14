from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth.dev import DevUser, get_current_user
from app.config import get_settings
from app.db.session import get_db
from app.graph.terraform_review.graph import run_terraform_review
from app.integrations.github import GitHubClient
from app.integrations.langsmith import configure_langsmith
from app.integrations.storage import FileSystemArtifactStore
from app.models import (
    ApprovalModel,
    ArtifactModel,
    EvidenceModel,
    FindingModel,
    GitHubCommentModel,
    RemediationModel,
    RunModel,
)
from app.schemas.review import (
    ApprovalRequest,
    DecisionResponse,
    Finding,
    GitHubCommentResponse,
    GitHubPRContext,
    ReportResponse,
    RiskScore,
    RunDetail,
    RunListItem,
    TerraformReviewCreateResponse,
)
from app.services.risk import severity_counts
from app.services.terraform_plan import TerraformPlanError, validate_terraform_plan


router = APIRouter(prefix="/api/v1", tags=["terraform reviews"])


@router.post("/terraform-reviews", response_model=TerraformReviewCreateResponse)
async def create_terraform_review(
    file: Annotated[UploadFile, File()],
    environment: Annotated[str, Form()] = "dev",
    cloud_provider: Annotated[str, Form()] = "aws",
    repo_owner: Annotated[str | None, Form()] = None,
    repo_name: Annotated[str | None, Form()] = None,
    pull_number: Annotated[int | None, Form()] = None,
    policy_profile: Annotated[str, Form()] = "default",
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> TerraformReviewCreateResponse:
    settings = get_settings()
    raw_bytes = await file.read()
    try:
        raw_plan = json.loads(raw_bytes)
        validate_terraform_plan(raw_plan)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Uploaded file is not valid JSON.") from exc
    except TerraformPlanError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    run = RunModel(
        user_id=user.id,
        mode="terraform_pr_review",
        status="running",
        environment=environment,
        cloud_provider=cloud_provider,
        policy_profile=policy_profile,
        repo_owner=repo_owner,
        repo_name=repo_name,
        pull_number=pull_number,
        approval_status="pending",
        summary="Terraform review is running.",
    )
    db.add(run)
    db.flush()

    store = FileSystemArtifactStore(settings.artifact_root)
    raw_uri, raw_sha = store.write_bytes(run.id, file.filename or "tfplan.json", raw_bytes)
    raw_artifact = ArtifactModel(
        run_id=run.id,
        type="terraform_plan_raw",
        storage_uri=raw_uri,
        sha256=raw_sha,
        redacted=False,
    )
    db.add(raw_artifact)
    db.commit()
    db.refresh(run)
    db.refresh(raw_artifact)

    input_artifacts = [{"id": raw_artifact.id, "type": raw_artifact.type, "uri": raw_uri}]
    repo_context = {
        "repo_owner": repo_owner,
        "repo_name": repo_name,
        "pull_number": pull_number,
    }
    github_pr_context = await _fetch_and_store_github_context(
        db,
        store,
        run.id,
        repo_owner,
        repo_name,
        pull_number,
    )
    if github_pr_context:
        repo_context["github_pr_context"] = github_pr_context
        github_artifact = db.scalar(
            select(ArtifactModel)
            .where(ArtifactModel.run_id == run.id)
            .where(ArtifactModel.type == "github_pr_context")
            .order_by(ArtifactModel.created_at.desc())
        )
        if github_artifact:
            input_artifacts.append(
                {
                    "id": github_artifact.id,
                    "type": github_artifact.type,
                    "uri": github_artifact.storage_uri,
                }
            )

    trace_id = configure_langsmith(settings)
    try:
        final_state = run_terraform_review(
            {
                "run_id": run.id,
                "user_id": user.id,
                "mode": "terraform_pr_review",
                "input_artifacts": input_artifacts,
                "repo_context": repo_context,
                "policy_profile": policy_profile,
                "environment": environment,
                "cloud_provider": cloud_provider,
                "raw_plan": raw_plan,
                "raw_plan_ref": raw_uri,
                "artifact_storage_dir": str(settings.artifact_root),
                "trace_id": trace_id,
                "approval_status": "pending",
                "graph_progress": [],
            }
        )
    except Exception as exc:
        run.status = "failed"
        run.summary = f"Terraform review failed: {exc}"
        run.completed_at = datetime.now(timezone.utc)
        db.add(run)
        db.commit()
        raise HTTPException(status_code=500, detail=run.summary) from exc

    _persist_final_state(db, run, final_state)
    db.commit()
    return TerraformReviewCreateResponse(run_id=run.id, status=run.status)


@router.get("/github/pr-context", response_model=GitHubPRContext)
async def get_github_pr_context(
    repo_owner: str = Query(..., min_length=1),
    repo_name: str = Query(..., min_length=1),
    pull_number: int = Query(..., ge=1),
) -> GitHubPRContext:
    settings = get_settings()
    context = await GitHubClient(settings.github_token).fetch_pr_context(
        repo_owner,
        repo_name,
        pull_number,
    )
    return GitHubPRContext(**context.to_dict())


@router.get("/runs", response_model=list[RunListItem])
def list_runs(db: Session = Depends(get_db)) -> list[RunListItem]:
    runs = db.scalars(
        select(RunModel)
        .options(selectinload(RunModel.findings))
        .order_by(RunModel.created_at.desc())
        .limit(25)
    ).all()
    return [
        RunListItem(
            id=run.id,
            mode=run.mode,
            status=run.status,
            environment=run.environment,
            cloud_provider=run.cloud_provider,
            risk_score=run.risk_score,
            risk_level=run.risk_level,
            summary=run.summary,
            approval_status=run.approval_status,
            created_at=run.created_at,
            completed_at=run.completed_at,
            severity_counts=severity_counts([_finding_dict(finding) for finding in run.findings]),
        )
        for run in runs
    ]


@router.get("/runs/{run_id}", response_model=RunDetail)
def get_run(run_id: str, db: Session = Depends(get_db)) -> RunDetail:
    run = _get_run_or_404(db, run_id, with_findings=True)
    return _run_detail(run)


@router.get("/runs/{run_id}/findings", response_model=list[Finding])
def get_findings(run_id: str, db: Session = Depends(get_db)) -> list[Finding]:
    run = _get_run_or_404(db, run_id, with_findings=True)
    return [_finding_schema(finding) for finding in run.findings]


@router.get("/runs/{run_id}/report", response_model=ReportResponse)
def get_report(run_id: str, db: Session = Depends(get_db)) -> ReportResponse:
    run = _get_run_or_404(db, run_id)
    risk = run.risk_score_detail or {
        "overall_score": run.risk_score,
        "risk_level": run.risk_level,
        "summary": run.summary,
        "top_drivers": [],
    }
    return ReportResponse(
        run_id=run.id,
        report_markdown=run.report_markdown,
        pr_comment_draft=run.pr_comment_draft,
        remediation_summary=run.remediation_summary,
        risk_score=RiskScore(**risk),
    )


@router.post("/runs/{run_id}/approve", response_model=DecisionResponse)
def approve_run(
    run_id: str,
    request: ApprovalRequest,
    db: Session = Depends(get_db),
) -> DecisionResponse:
    run = _get_run_or_404(db, run_id)
    run.status = "approved"
    run.approval_status = "approved"
    db.add(ApprovalModel(run_id=run.id, decision="approved", notes=request.notes))
    db.add(run)
    db.commit()
    return DecisionResponse(run_id=run.id, decision="approved", status=run.status)


@router.post("/runs/{run_id}/reject", response_model=DecisionResponse)
def reject_run(
    run_id: str,
    request: ApprovalRequest,
    db: Session = Depends(get_db),
) -> DecisionResponse:
    run = _get_run_or_404(db, run_id)
    run.status = "rejected"
    run.approval_status = "rejected"
    db.add(ApprovalModel(run_id=run.id, decision="rejected", notes=request.notes))
    db.add(run)
    db.commit()
    return DecisionResponse(run_id=run.id, decision="rejected", status=run.status)


@router.post("/runs/{run_id}/github-comment", response_model=GitHubCommentResponse)
async def post_github_comment(run_id: str, db: Session = Depends(get_db)) -> GitHubCommentResponse:
    run = _get_run_or_404(db, run_id)
    if run.approval_status != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Human approval is required before posting a GitHub comment.",
        )
    settings = get_settings()
    result = await GitHubClient(settings.github_token).post_pr_comment(
        run.repo_owner,
        run.repo_name,
        run.pull_number,
        run.pr_comment_draft,
    )
    if result.comment_url or result.mock:
        db.add(
            GitHubCommentModel(
                run_id=run.id,
                repo_owner=run.repo_owner or "mock-owner",
                repo_name=run.repo_name or "mock-repo",
                pull_number=run.pull_number or 0,
                comment_url=result.comment_url,
            )
        )
        run.status = "comment_posted" if result.posted else "mock_comment_ready"
        db.add(run)
        db.commit()
    return GitHubCommentResponse(
        run_id=run.id,
        posted=result.posted,
        mock=result.mock,
        message=result.message,
        comment_url=result.comment_url,
    )


def _persist_final_state(db: Session, run: RunModel, final_state: dict[str, Any]) -> None:
    redacted_uri = final_state.get("redacted_plan_ref")
    if redacted_uri:
        db.add(
            ArtifactModel(
                run_id=run.id,
                type="terraform_plan_redacted",
                storage_uri=redacted_uri,
                sha256=final_state.get("redacted_plan_sha256", ""),
                redacted=True,
            )
        )

    findings = final_state.get("merged_findings", [])
    for item in findings:
        finding = FindingModel(
            id=item["id"],
            run_id=run.id,
            title=item["title"],
            description=item["description"],
            severity=item["severity"],
            category=item["category"],
            resource_address=item.get("resource_address"),
            resource_type=item.get("resource_type"),
            provider=item.get("provider"),
            change_actions=item.get("change_actions", []),
            impact=item.get("impact", ""),
            recommendation=item.get("recommendation", ""),
            compliance_refs=item.get("compliance_refs", []),
            confidence=item.get("confidence", 1.0),
            source=item.get("source", "deterministic_rule"),
            reviewer_node=item.get("reviewer_node", "deterministic_policy_checks"),
            requires_human_review=item.get("requires_human_review", False),
        )
        db.add(finding)
        for evidence in item.get("evidence", []):
            db.add(
                EvidenceModel(
                    finding_id=finding.id,
                    json_path=evidence.get("json_path", "$"),
                    observed_value=_stringify(evidence.get("observed_value")),
                    expected_value=_stringify(evidence.get("expected_value")),
                    rule_id=evidence.get("rule_id"),
                    explanation=evidence.get("explanation", ""),
                )
            )
        remediation = item.get("remediation")
        if remediation:
            db.add(
                RemediationModel(
                    finding_id=finding.id,
                    language=remediation.get("language", "hcl"),
                    snippet=remediation.get("snippet", ""),
                    explanation=remediation.get("explanation", ""),
                    risk_of_change=remediation.get("risk_of_change", "medium"),
                )
            )

    risk_score = final_state.get("risk_score", {})
    run.status = "approval_pending"
    run.approval_status = final_state.get("approval_status", "pending")
    run.risk_score = risk_score.get("overall_score", 0)
    run.risk_level = risk_score.get("risk_level", "low")
    run.risk_score_detail = risk_score
    run.summary = risk_score.get("summary", "")
    run.trace_id = final_state.get("trace_id")
    run.graph_progress = final_state.get("graph_progress", [])
    run.plan_summary = final_state.get("plan_summary", {})
    run.report_markdown = final_state.get("report_markdown", "")
    run.pr_comment_draft = final_state.get("pr_comment_draft", "")
    run.remediation_summary = final_state.get("remediation_summary", "")
    run.completed_at = datetime.now(timezone.utc)
    db.add(run)


async def _fetch_and_store_github_context(
    db: Session,
    store: FileSystemArtifactStore,
    run_id: str,
    repo_owner: str | None,
    repo_name: str | None,
    pull_number: int | None,
) -> dict[str, Any] | None:
    if not repo_owner or not repo_name or not pull_number:
        return None

    settings = get_settings()
    context = await GitHubClient(settings.github_token).fetch_pr_context(
        repo_owner,
        repo_name,
        pull_number,
    )
    payload = context.to_dict()
    storage_uri, sha = store.write_json(run_id, "github-pr-context.json", payload)
    db.add(
        ArtifactModel(
            run_id=run_id,
            type="github_pr_context",
            storage_uri=storage_uri,
            sha256=sha,
            redacted=True,
        )
    )
    db.commit()
    return payload


def _get_run_or_404(db: Session, run_id: str, with_findings: bool = False) -> RunModel:
    query = select(RunModel).where(RunModel.id == run_id)
    if with_findings:
        query = query.options(
            selectinload(RunModel.artifacts),
            selectinload(RunModel.findings).selectinload(FindingModel.evidence),
            selectinload(RunModel.findings).selectinload(FindingModel.remediations),
        )
    else:
        query = query.options(selectinload(RunModel.artifacts))
    run = db.scalar(query)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    return run


def _run_detail(run: RunModel) -> RunDetail:
    return RunDetail(
        id=run.id,
        mode=run.mode,
        status=run.status,
        environment=run.environment,
        cloud_provider=run.cloud_provider,
        policy_profile=run.policy_profile,
        risk_score=run.risk_score,
        risk_level=run.risk_level,
        summary=run.summary,
        trace_id=run.trace_id,
        graph_progress=run.graph_progress or [],
        plan_summary=run.plan_summary or {},
        approval_status=run.approval_status,
        repo_owner=run.repo_owner,
        repo_name=run.repo_name,
        pull_number=run.pull_number,
        github_pr_context=_github_context_schema(run),
        created_at=run.created_at,
        completed_at=run.completed_at,
        severity_counts=severity_counts([_finding_dict(finding) for finding in run.findings]),
    )


def _github_context_schema(run: RunModel) -> GitHubPRContext | None:
    artifact = next(
        (item for item in run.artifacts if item.type == "github_pr_context"),
        None,
    )
    if not artifact:
        if run.repo_owner and run.repo_name and run.pull_number:
            return GitHubPRContext(
                available=False,
                mock=True,
                message="GitHub PR context has not been fetched for this run.",
                repo_owner=run.repo_owner,
                repo_name=run.repo_name,
                repo_full_name=f"{run.repo_owner}/{run.repo_name}",
                pull_number=run.pull_number,
            )
        return None
    try:
        payload = json.loads(Path(artifact.storage_uri).read_text())
    except Exception:
        return GitHubPRContext(
            available=False,
            mock=False,
            message="Stored GitHub PR context artifact could not be read.",
            repo_owner=run.repo_owner,
            repo_name=run.repo_name,
            pull_number=run.pull_number,
        )
    return GitHubPRContext(**payload)


def _finding_schema(finding: FindingModel) -> Finding:
    rem = finding.remediations[0] if finding.remediations else None
    return Finding(
        id=finding.id,
        title=finding.title,
        description=finding.description,
        severity=finding.severity,
        category=finding.category,
        resource_address=finding.resource_address,
        resource_type=finding.resource_type,
        provider=finding.provider,
        change_actions=finding.change_actions or [],
        evidence=[
            {
                "source_artifact": evidence.source_artifact_id,
                "json_path": evidence.json_path,
                "observed_value": evidence.observed_value,
                "expected_value": evidence.expected_value,
                "rule_id": evidence.rule_id,
                "explanation": evidence.explanation,
            }
            for evidence in finding.evidence
        ],
        impact=finding.impact,
        recommendation=finding.recommendation,
        remediation=(
            {
                "language": rem.language,
                "snippet": rem.snippet,
                "explanation": rem.explanation,
                "risk_of_change": rem.risk_of_change,
            }
            if rem
            else None
        ),
        compliance_refs=finding.compliance_refs or [],
        confidence=finding.confidence,
        source=finding.source,
        reviewer_node=finding.reviewer_node,
        requires_human_review=finding.requires_human_review,
    )


def _finding_dict(finding: FindingModel) -> dict[str, Any]:
    return {
        "severity": finding.severity,
        "title": finding.title,
        "category": finding.category,
        "resource_address": finding.resource_address,
    }


def _stringify(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, sort_keys=True)
