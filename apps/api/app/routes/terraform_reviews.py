from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.auth.dev import DevUser, get_current_user, require_role
from app.config import get_settings
from app.db.session import SessionLocal, get_db
from app.graph.terraform_review.graph import stream_terraform_review
from app.integrations.github import (
    GitHubCheckResult,
    GitHubClient,
    GitHubPatchCommitResult,
    GitHubPostResult,
    GitHubPRContext as GitHubPRContextData,
)
from app.integrations.langsmith import configure_langsmith
from app.integrations.storage import FileSystemArtifactStore
from app.models import (
    ApprovalModel,
    ArtifactModel,
    AuditLogModel,
    EvidenceModel,
    FindingModel,
    FixPatchModel,
    GitHubCheckModel,
    GitHubCommentModel,
    RemediationModel,
    ReviewJobModel,
    RunModel,
    RunbookProgressModel,
    UserModel,
)
from app.schemas.review import (
    ApprovalRequest,
    ArtifactSummary,
    AuthUser,
    AuditLogEntry,
    DemoSamplePlan,
    DemoTerraformReviewRequest,
    DecisionResponse,
    Finding,
    FixPatch,
    GitHubCommentResponse,
    GitHubPRContext,
    PatchCommitResponse,
    ReportResponse,
    RiskScore,
    RunDetail,
    RunListItem,
    RunbookProgressEntry,
    RunbookProgressUpdate,
    TerraformReviewCreateResponse,
    UploadedTerraformReviewRequest,
)
from app.services.github_context import redact_github_patch_context
from app.services.fix_patches import suggested_fix_patches
from app.services.policy_packs import get_policy_pack, list_policy_packs, save_policy_pack
from app.services.risk import severity_counts
from app.services.terraform_plan import TerraformPlanError, validate_terraform_plan
from app.services.terraform_sandbox import TerraformSandboxError, TerraformSandboxRunner


router = APIRouter(prefix="/api/v1", tags=["terraform reviews"])


DEMO_SAMPLE_PLANS: dict[str, dict[str, str]] = {
    "safe": {
        "filename": "safe-plan.json",
        "label": "Safe baseline",
        "description": "A low-risk Terraform plan with compliant tagging and no public exposure.",
        "environment": "dev",
        "cloud_provider": "aws",
        "policy_profile": "default",
    },
    "risky-security": {
        "filename": "risky-security-plan.json",
        "label": "Public exposure",
        "description": "Public SSH, public RDS, and wildcard IAM findings for a security-heavy demo.",
        "environment": "prod",
        "cloud_provider": "aws",
        "policy_profile": "default",
    },
    "risky-cost": {
        "filename": "risky-cost-plan.json",
        "label": "Cost spike",
        "description": "Large compute, NAT gateway, and tagging gaps for cost governance review.",
        "environment": "staging",
        "cloud_provider": "aws",
        "policy_profile": "startup_cost_control",
    },
    "destructive-prod": {
        "filename": "destructive-prod-plan.json",
        "label": "Destructive production change",
        "description": "Stateful replacement and weak rollback controls for blast-radius analysis.",
        "environment": "prod",
        "cloud_provider": "aws",
        "policy_profile": "restricted",
    },
}


@router.get("/auth/me", response_model=AuthUser)
def get_auth_user(user: DevUser = Depends(get_current_user)) -> AuthUser:
    return AuthUser(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        org_id=user.org_id,
        groups=user.groups,
        auth_provider=user.auth_provider,
    )


@router.get("/demo/sample-plans", response_model=list[DemoSamplePlan])
def list_demo_sample_plans() -> list[DemoSamplePlan]:
    return [
        DemoSamplePlan(sample=sample, **metadata)
        for sample, metadata in DEMO_SAMPLE_PLANS.items()
    ]


@router.post("/demo/terraform-reviews", response_model=TerraformReviewCreateResponse)
async def create_demo_terraform_review(
    request: DemoTerraformReviewRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> TerraformReviewCreateResponse:
    settings = get_settings()
    if not settings.public_demo_mode and settings.auth_mode.lower() != "dev":
        raise HTTPException(
            status_code=403,
            detail="Demo sample reviews require PUBLIC_DEMO_MODE=true or local dev auth.",
        )
    sample = DEMO_SAMPLE_PLANS.get(request.sample)
    if not sample:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown demo sample '{request.sample}'.",
        )

    plan_path = _demo_plan_path(settings, sample["filename"])
    raw_bytes = plan_path.read_bytes()
    try:
        raw_plan = json.loads(raw_bytes)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Demo sample plan is not valid JSON.") from exc

    try:
        validate_terraform_plan(raw_plan)
    except TerraformPlanError as exc:
        raise HTTPException(status_code=500, detail=f"Demo sample plan is invalid: {exc}") from exc

    run = await _create_and_queue_review(
        background_tasks=background_tasks,
        db=db,
        user=None,
        raw_bytes=raw_bytes,
        source_filename=sample["filename"],
        environment=request.environment or sample["environment"],
        cloud_provider=request.cloud_provider or sample["cloud_provider"],
        policy_profile=request.policy_profile or sample["policy_profile"],
        repo_owner=request.repo_owner,
        repo_name=request.repo_name,
        pull_number=request.pull_number,
        terraform_execution={
            "mode": "demo_sample",
            "sample": request.sample,
            "source": f"sample-data/terraform-plans/{sample['filename']}",
        },
    )
    return TerraformReviewCreateResponse(run_id=run.id, status=run.status)


@router.post("/terraform-reviews", response_model=TerraformReviewCreateResponse)
async def create_terraform_review(
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile | None, File()] = None,
    environment: Annotated[str, Form()] = "dev",
    cloud_provider: Annotated[str, Form()] = "aws",
    repo_owner: Annotated[str | None, Form()] = None,
    repo_name: Annotated[str | None, Form()] = None,
    pull_number: Annotated[int | None, Form()] = None,
    policy_profile: Annotated[str, Form()] = "default",
    execution_mode: Annotated[str, Form()] = "uploaded_plan",
    terraform_working_dir: Annotated[str | None, Form()] = None,
    terraform_workspace: Annotated[str | None, Form()] = None,
    terraform_env_vars_json: Annotated[str | None, Form()] = None,
    terraform_backend_config_json: Annotated[str | None, Form()] = None,
    terraform_backend_enabled: Annotated[bool, Form()] = False,
    terraform_var_file: Annotated[str | None, Form()] = None,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> TerraformReviewCreateResponse:
    require_role(user, {"reviewer", "platform-admin"})
    settings = get_settings()
    terraform_execution = {"mode": "uploaded_plan"}
    source_filename = "tfplan.json"
    if execution_mode == "sandbox_plan":
        if settings.public_demo_mode and settings.public_demo_disable_sandbox:
            raise HTTPException(
                status_code=403,
                detail="Terraform sandbox execution is disabled in public demo mode. Use a sample review or upload a plan JSON.",
            )
        try:
            sandbox_result = TerraformSandboxRunner(settings).create_plan_json(
                terraform_working_dir,
                workspace=terraform_workspace,
                env_vars=_json_object_form(terraform_env_vars_json, "terraform_env_vars_json"),
                backend_config=_json_object_form(terraform_backend_config_json, "terraform_backend_config_json"),
                backend_enabled=terraform_backend_enabled,
                var_file=terraform_var_file,
            )
        except TerraformSandboxError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        raw_plan = sandbox_result.plan
        raw_bytes = json.dumps(raw_plan, sort_keys=True).encode()
        source_filename = "sandbox-tfplan.json"
        terraform_execution = sandbox_result.metadata
    else:
        if file is None:
            raise HTTPException(status_code=400, detail="Choose a Terraform plan JSON file or enable sandbox execution.")
        if settings.public_demo_mode and not settings.public_demo_allow_uploads:
            raise HTTPException(
                status_code=403,
                detail="Plan uploads are disabled in public demo mode. Use one of the bundled sample reviews.",
            )
        raw_bytes = await _read_upload_bytes(file, settings)
        source_filename = file.filename or "tfplan.json"
        try:
            raw_plan = json.loads(raw_bytes)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Uploaded file is not valid JSON.") from exc

    try:
        validate_terraform_plan(raw_plan)
    except TerraformPlanError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    run = await _create_and_queue_review(
        background_tasks=background_tasks,
        db=db,
        user=user,
        raw_bytes=raw_bytes,
        source_filename=source_filename,
        environment=environment,
        cloud_provider=cloud_provider,
        policy_profile=policy_profile,
        repo_owner=repo_owner,
        repo_name=repo_name,
        pull_number=pull_number,
        terraform_execution=terraform_execution,
    )
    return TerraformReviewCreateResponse(run_id=run.id, status=run.status)


@router.post("/terraform-reviews/json", response_model=TerraformReviewCreateResponse)
async def create_terraform_review_from_json_upload(
    request: UploadedTerraformReviewRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> TerraformReviewCreateResponse:
    require_role(user, {"reviewer", "platform-admin"})
    settings = get_settings()
    if settings.public_demo_mode and not settings.public_demo_allow_uploads:
        raise HTTPException(
            status_code=403,
            detail="Plan uploads are disabled in public demo mode. Use one of the bundled sample reviews.",
        )

    raw_bytes = request.plan_json_text.encode()
    _enforce_public_demo_upload_limit(raw_bytes, settings)
    try:
        raw_plan = json.loads(raw_bytes)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Uploaded file is not valid JSON.") from exc

    try:
        validate_terraform_plan(raw_plan)
    except TerraformPlanError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    run = await _create_and_queue_review(
        background_tasks=background_tasks,
        db=db,
        user=user,
        raw_bytes=raw_bytes,
        source_filename=request.file_name or "tfplan.json",
        environment=request.environment,
        cloud_provider=request.cloud_provider,
        policy_profile=request.policy_profile,
        repo_owner=request.repo_owner,
        repo_name=request.repo_name,
        pull_number=request.pull_number,
        terraform_execution={"mode": "uploaded_plan"},
    )
    return TerraformReviewCreateResponse(run_id=run.id, status=run.status)


@router.get("/github/pr-context", response_model=GitHubPRContext)
async def get_github_pr_context(
    repo_owner: str = Query(..., min_length=1),
    repo_name: str = Query(..., min_length=1),
    pull_number: int = Query(..., ge=1),
    _user: DevUser = Depends(get_current_user),
) -> GitHubPRContext:
    settings = get_settings()
    if settings.public_demo_mode and not settings.public_demo_allow_live_github_reads:
        return GitHubPRContext(
            **_public_demo_pr_context(repo_owner, repo_name, pull_number).to_dict()
        )
    context = await _github_client(settings).fetch_pr_context(
        repo_owner,
        repo_name,
        pull_number,
    )
    return GitHubPRContext(**context.to_dict())


@router.post("/github/webhook", status_code=status.HTTP_202_ACCEPTED)
async def github_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_github_event: Annotated[str | None, Header(alias="X-GitHub-Event")] = None,
    x_hub_signature_256: Annotated[str | None, Header(alias="X-Hub-Signature-256")] = None,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    settings = get_settings()
    body = await request.body()
    _verify_github_signature(body, x_hub_signature_256, settings.github_webhook_secret)
    payload = json.loads(body or b"{}")
    if x_github_event == "ping":
        return {"accepted": True, "event": "ping"}
    if x_github_event != "pull_request":
        return {"accepted": False, "event": x_github_event, "reason": "Only pull_request webhooks trigger reviews."}
    action = payload.get("action")
    if action not in {"opened", "synchronize", "reopened", "ready_for_review"}:
        return {"accepted": False, "event": x_github_event, "action": action, "reason": "Pull request action does not trigger review."}

    repository = payload.get("repository") or {}
    pull_request = payload.get("pull_request") or {}
    owner = ((repository.get("owner") or {}).get("login") or "").strip()
    repo_name = str(repository.get("name") or "").strip()
    pull_number = int(pull_request.get("number") or payload.get("number") or 0)
    working_dir = _format_working_dir(
        settings.github_webhook_terraform_working_dir,
        owner=owner,
        repo=repo_name,
        repo_full_name=repository.get("full_name") or f"{owner}/{repo_name}",
    )
    if not working_dir:
        return {
            "accepted": False,
            "reason": "Set GITHUB_WEBHOOK_TERRAFORM_WORKING_DIR to enable automatic Terraform plan execution.",
            "repo": repository.get("full_name"),
            "pull_number": pull_number,
        }
    if settings.public_demo_mode and settings.public_demo_disable_sandbox:
        return {
            "accepted": False,
            "reason": "Automatic Terraform plan execution is disabled in public demo mode.",
            "repo": repository.get("full_name"),
            "pull_number": pull_number,
        }
    try:
        sandbox_result = TerraformSandboxRunner(settings).create_plan_json(working_dir)
    except TerraformSandboxError as exc:
        return {
            "accepted": False,
            "reason": str(exc),
            "repo": repository.get("full_name"),
            "pull_number": pull_number,
        }

    run = await _create_and_queue_review(
        background_tasks=background_tasks,
        db=db,
        user=None,
        raw_bytes=json.dumps(sandbox_result.plan, sort_keys=True).encode(),
        source_filename="github-webhook-tfplan.json",
        environment=settings.github_webhook_environment,
        cloud_provider=settings.github_webhook_cloud_provider,
        policy_profile=settings.github_webhook_policy_profile,
        repo_owner=owner or None,
        repo_name=repo_name or None,
        pull_number=pull_number or None,
        terraform_execution={**sandbox_result.metadata, "trigger": "github_webhook", "webhook_action": action},
    )
    _record_audit(
        db,
        action="github.webhook_review_queued",
        run_id=run.id,
        metadata={
            "event": x_github_event,
            "action": action,
            "repo": repository.get("full_name"),
            "pull_number": pull_number,
            "head_sha": (pull_request.get("head") or {}).get("sha"),
        },
    )
    db.commit()
    return {"accepted": True, "run_id": run.id, "status": run.status}


@router.get("/policy-packs")
def get_policy_packs(_user: DevUser = Depends(get_current_user)) -> list[dict[str, Any]]:
    return list_policy_packs()


@router.get("/policy-packs/{name}")
def read_policy_pack(name: str, _user: DevUser = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return get_policy_pack(name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/policy-packs/{name}")
def update_policy_pack(
    name: str,
    payload: Annotated[dict[str, Any], Body()],
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> dict[str, Any]:
    require_role(user, {"platform-admin"})
    if get_settings().public_demo_mode:
        raise HTTPException(
            status_code=403,
            detail="Policy packs are read-only in public demo mode. Fork the repo or run locally to edit policy files.",
        )
    try:
        saved = save_policy_pack(name, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _record_audit(
        db,
        action="policy_pack.updated",
        actor=user,
        target_type="policy_pack",
        target_id=name,
        metadata={"policy_pack": saved},
    )
    db.commit()
    return saved


@router.get("/runs", response_model=list[RunListItem])
def list_runs(
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> list[RunListItem]:
    runs = db.scalars(
        _scope_run_query(select(RunModel), user)
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
def get_run(
    run_id: str,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> RunDetail:
    run = _get_run_or_404(db, run_id, with_findings=True, user=user)
    return _run_detail(run)


@router.get("/runs/{run_id}/findings", response_model=list[Finding])
def get_findings(
    run_id: str,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> list[Finding]:
    run = _get_run_or_404(db, run_id, with_findings=True, user=user)
    return [_finding_schema(finding) for finding in run.findings]


@router.get("/runs/{run_id}/report", response_model=ReportResponse)
def get_report(
    run_id: str,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> ReportResponse:
    run = _get_run_or_404(db, run_id, user=user)
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
    user: DevUser = Depends(get_current_user),
) -> DecisionResponse:
    require_role(user, {"reviewer", "platform-admin"})
    run = _get_run_or_404(db, run_id, user=user)
    run.status = "approved"
    run.approval_status = "approved"
    db.add(ApprovalModel(run_id=run.id, decision="approved", notes=request.notes))
    _record_audit(
        db,
        action="approval.approved",
        run_id=run.id,
        actor=user,
        target_id=run.id,
        metadata={"notes": request.notes},
    )
    db.add(run)
    db.commit()
    return DecisionResponse(run_id=run.id, decision="approved", status=run.status)


@router.post("/runs/{run_id}/reject", response_model=DecisionResponse)
def reject_run(
    run_id: str,
    request: ApprovalRequest,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> DecisionResponse:
    require_role(user, {"reviewer", "platform-admin"})
    run = _get_run_or_404(db, run_id, user=user)
    run.status = "rejected"
    run.approval_status = "rejected"
    db.add(ApprovalModel(run_id=run.id, decision="rejected", notes=request.notes))
    _record_audit(
        db,
        action="approval.rejected",
        run_id=run.id,
        actor=user,
        target_id=run.id,
        metadata={"notes": request.notes},
    )
    db.add(run)
    db.commit()
    return DecisionResponse(run_id=run.id, decision="rejected", status=run.status)


@router.post("/runs/{run_id}/github-comment", response_model=GitHubCommentResponse)
async def post_github_comment(
    run_id: str,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> GitHubCommentResponse:
    require_role(user, {"reviewer", "platform-admin"})
    run = _get_run_or_404(db, run_id, user=user)
    if run.approval_status != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Human approval is required before posting a GitHub comment.",
        )
    settings = get_settings()
    if settings.public_demo_mode and settings.public_demo_mock_github_writes:
        result = GitHubPostResult(
            posted=False,
            mock=True,
            message=(
                "Public demo mode: approval was recorded, but no external GitHub comment was posted. "
                f"Would post to {run.repo_owner or 'owner'}/{run.repo_name or 'repo'} PR #{run.pull_number or 0}."
            ),
        )
    else:
        result = await _github_client(settings).post_pr_comment(
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
        _record_audit(
            db,
            action="github.comment_posted" if result.posted else "github.comment_mocked",
            run_id=run.id,
            actor=user,
            metadata={"message": result.message, "comment_url": result.comment_url},
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


@router.get("/runs/{run_id}/audit-log", response_model=list[AuditLogEntry])
def get_audit_log(
    run_id: str,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> list[AuditLogEntry]:
    _get_run_or_404(db, run_id, user=user)
    entries = db.scalars(
        select(AuditLogModel)
        .where(AuditLogModel.run_id == run_id)
        .order_by(AuditLogModel.created_at.desc())
        .limit(100)
    ).all()
    return [
        {
            "id": entry.id,
            "action": entry.action,
            "actor_email": entry.actor_email,
            "target_type": entry.target_type,
            "target_id": entry.target_id,
            "metadata": entry.metadata_json or {},
            "created_at": entry.created_at,
        }
        for entry in entries
    ]


@router.get("/runs/{run_id}/runbook-progress", response_model=list[RunbookProgressEntry])
def get_runbook_progress(
    run_id: str,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> list[RunbookProgressEntry]:
    _get_run_or_404(db, run_id, user=user)
    entries = db.scalars(
        select(RunbookProgressModel)
        .where(RunbookProgressModel.run_id == run_id)
        .order_by(RunbookProgressModel.updated_at.asc())
    ).all()
    return [
        RunbookProgressEntry(
            step_id=entry.step_id,
            section_id=entry.section_id,
            checked=entry.checked,
            actor_email=entry.actor_email,
            updated_at=entry.updated_at,
        )
        for entry in entries
    ]


@router.put("/runs/{run_id}/runbook-progress/{step_id}", response_model=RunbookProgressEntry)
def update_runbook_progress(
    run_id: str,
    step_id: str,
    request: RunbookProgressUpdate,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> RunbookProgressEntry:
    require_role(user, {"reviewer", "platform-admin"})
    _get_run_or_404(db, run_id, user=user)
    entry = db.scalar(
        select(RunbookProgressModel)
        .where(RunbookProgressModel.run_id == run_id)
        .where(RunbookProgressModel.step_id == step_id)
    )
    if not entry:
        entry = RunbookProgressModel(run_id=run_id, step_id=step_id)
    entry.checked = request.checked
    entry.section_id = request.section_id
    entry.actor_email = user.email
    entry.updated_at = datetime.now(timezone.utc)
    db.add(entry)
    _record_audit(
        db,
        action="runbook.step_checked" if request.checked else "runbook.step_unchecked",
        run_id=run_id,
        actor=user,
        target_type="runbook_step",
        target_id=step_id,
        metadata={"section_id": request.section_id, "checked": request.checked},
    )
    db.commit()
    db.refresh(entry)
    return RunbookProgressEntry(
        step_id=entry.step_id,
        section_id=entry.section_id,
        checked=entry.checked,
        actor_email=entry.actor_email,
        updated_at=entry.updated_at,
    )


@router.get("/runs/{run_id}/fix-patches", response_model=list[FixPatch])
def get_fix_patches(
    run_id: str,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> list[FixPatch]:
    _get_run_or_404(db, run_id, user=user)
    patches = db.scalars(
        select(FixPatchModel)
        .where(FixPatchModel.run_id == run_id)
        .order_by(FixPatchModel.created_at.asc())
    ).all()
    return [_fix_patch_schema(patch) for patch in patches]


@router.post("/runs/{run_id}/fix-patches/{patch_id}/approve", response_model=FixPatch)
def approve_fix_patch(
    run_id: str,
    patch_id: str,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> FixPatch:
    require_role(user, {"reviewer", "platform-admin"})
    _get_run_or_404(db, run_id, user=user)
    patch = db.scalar(
        select(FixPatchModel)
        .where(FixPatchModel.run_id == run_id)
        .where(FixPatchModel.id == patch_id)
    )
    if not patch:
        raise HTTPException(status_code=404, detail="Fix patch not found.")
    patch.status = "approved"
    patch.approved_at = datetime.now(timezone.utc)
    db.add(patch)
    _record_audit(
        db,
        action="fix_patch.approved",
        run_id=run_id,
        actor=user,
        target_type="fix_patch",
        target_id=patch.id,
        metadata={"summary": patch.summary},
    )
    db.commit()
    return _fix_patch_schema(patch)


@router.post("/runs/{run_id}/fix-patches/{patch_id}/github-commit", response_model=PatchCommitResponse)
def commit_fix_patch_to_github(
    run_id: str,
    patch_id: str,
    db: Session = Depends(get_db),
    user: DevUser = Depends(get_current_user),
) -> PatchCommitResponse:
    require_role(user, {"platform-admin"})
    run = _get_run_or_404(db, run_id, user=user)
    patch = db.scalar(
        select(FixPatchModel)
        .where(FixPatchModel.run_id == run_id)
        .where(FixPatchModel.id == patch_id)
    )
    if not patch:
        raise HTTPException(status_code=404, detail="Fix patch not found.")
    if patch.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Patch approval is required before committing a suggested fix.",
        )

    settings = get_settings()
    if settings.public_demo_mode and settings.public_demo_mock_github_writes:
        result = GitHubPatchCommitResult(
            committed=False,
            mock=True,
            message=(
                "Public demo mode: patch approval was recorded, but no commit was pushed. "
                f"Would commit the approved patch to {run.repo_owner or 'owner'}/{run.repo_name or 'repo'} PR #{run.pull_number or 0}."
            ),
        )
    else:
        result = _run_async(
            _github_client(settings).commit_patch_to_pr_branch(
                run.repo_owner,
                run.repo_name,
                run.pull_number,
                patch.pr_file_path,
                patch.diff,
                commit_message=f"fix(terraform): apply TerraGate remediation for {run.id}",
            )
        )
    if result.committed:
        patch.status = "committed"
        patch.commit_url = result.commit_url
        patch.committed_at = datetime.now(timezone.utc)
        db.add(patch)
    _record_audit(
        db,
        action="fix_patch.committed" if result.committed else "fix_patch.commit_mocked",
        run_id=run_id,
        actor=user,
        target_type="fix_patch",
        target_id=patch.id,
        metadata={"message": result.message, "commit_url": result.commit_url, "mock": result.mock},
    )
    db.commit()
    return PatchCommitResponse(
        run_id=run.id,
        patch_id=patch.id,
        committed=result.committed,
        mock=result.mock,
        message=result.message,
        commit_url=result.commit_url,
    )


async def _create_and_queue_review(
    *,
    background_tasks: BackgroundTasks,
    db: Session,
    user: DevUser | None,
    raw_bytes: bytes,
    source_filename: str,
    environment: str,
    cloud_provider: str,
    policy_profile: str,
    repo_owner: str | None,
    repo_name: str | None,
    pull_number: int | None,
    terraform_execution: dict[str, Any],
) -> RunModel:
    settings = get_settings()
    _ensure_user_record(db, user)
    run = RunModel(
        user_id=user.id if user else None,
        org_id=user.org_id if user else ("public-demo" if settings.public_demo_mode else None),
        mode="terraform_pr_review",
        status="queued",
        environment=environment,
        cloud_provider=cloud_provider,
        policy_profile=policy_profile,
        repo_owner=repo_owner,
        repo_name=repo_name,
        pull_number=pull_number,
        approval_status="pending",
        summary="Terraform review is queued.",
        terraform_execution=terraform_execution,
    )
    db.add(run)
    db.flush()

    store = FileSystemArtifactStore(settings.artifact_root)
    raw_uri, raw_sha = store.write_bytes(run.id, source_filename, raw_bytes)
    raw_artifact = ArtifactModel(
        run_id=run.id,
        type="terraform_plan_raw",
        storage_uri=raw_uri,
        sha256=raw_sha,
        redacted=False,
    )
    db.add(raw_artifact)
    job = ReviewJobModel(run_id=run.id, status="queued")
    db.add(job)
    _record_audit(
        db,
        action="review.queued",
        run_id=run.id,
        actor=user,
        metadata={
            "policy_profile": policy_profile,
            "environment": environment,
            "raw_artifact_sha256": raw_sha,
            "terraform_execution": _safe_execution_metadata(terraform_execution),
        },
    )
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

    execution_payload = {
        "run_id": run.id,
        "user_id": user.id if user else None,
        "mode": "terraform_pr_review",
        "input_artifacts": input_artifacts,
        "repo_context": repo_context,
        "policy_profile": policy_profile,
        "environment": environment,
        "cloud_provider": cloud_provider,
        "raw_plan_ref": raw_uri,
        "artifact_storage_dir": str(settings.artifact_root),
        "terraform_execution": terraform_execution,
        "approval_status": "pending",
        "graph_progress": [{"node": "queued", "status": "queued", "timestamp": datetime.now(timezone.utc).isoformat()}],
    }
    job.payload = execution_payload
    db.add(job)
    db.commit()
    if settings.review_execution_mode == "inline":
        _execute_review_job(run.id, execution_payload)
    elif settings.review_execution_mode == "background":
        background_tasks.add_task(_execute_review_job, run.id, execution_payload)
    else:
        _record_audit(
            db,
            action="worker.dispatch_pending",
            run_id=run.id,
            target_id=job.id,
            metadata={"execution_mode": settings.review_execution_mode},
        )
        db.commit()
    return run


def _ensure_user_record(db: Session, user: DevUser | None) -> None:
    if not user or not user.id:
        return
    existing = db.scalar(select(UserModel).where(UserModel.id == user.id))
    if existing:
        existing.email = user.email
        existing.name = user.name
        db.add(existing)
        return
    db.add(UserModel(id=user.id, email=user.email, name=user.name))
    db.flush()


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
            pr_file_path=item.get("pr_file_path"),
            pr_file_url=item.get("pr_file_url"),
            pr_patch=item.get("pr_patch"),
            runbook_checklist=item.get("runbook_checklist", []),
        )
        db.add(finding)
        for evidence in item.get("evidence", []):
            db.add(
                EvidenceModel(
                    finding_id=finding.id,
                    json_path=evidence.get("json_path", "$"),
                    observed_value=_stringify(evidence.get("observed_value")) or "null",
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

    for patch in suggested_fix_patches(findings):
        db.add(
            FixPatchModel(
                run_id=run.id,
                finding_id=patch.get("finding_id"),
                pr_file_path=patch.get("pr_file_path"),
                summary=patch.get("summary", ""),
                diff=patch.get("diff", ""),
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
    run.cost_estimate = final_state.get("cost_estimate", {})
    run.blast_radius = final_state.get("blast_radius", {})
    run.terraform_execution = final_state.get("terraform_execution") or run.terraform_execution or {"mode": "uploaded_plan"}
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
    if settings.public_demo_mode and not settings.public_demo_allow_live_github_reads:
        context = _public_demo_pr_context(repo_owner, repo_name, pull_number)
    else:
        context = await _github_client(settings).fetch_pr_context(
            repo_owner,
            repo_name,
            pull_number,
        )
    payload = redact_github_patch_context(context.to_dict())
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


def _execute_review_job(run_id: str, initial_state: dict[str, Any]) -> None:
    settings = get_settings()
    with SessionLocal() as db:
        run = db.scalar(select(RunModel).where(RunModel.id == run_id))
        if not run:
            return
        job = db.scalar(
            select(ReviewJobModel)
            .where(ReviewJobModel.run_id == run_id)
            .order_by(ReviewJobModel.queued_at.desc())
        )
        if not job:
            job = ReviewJobModel(run_id=run_id)
            db.add(job)
            db.flush()
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.attempts += 1
        run.status = "running"
        run.summary = "Terraform review is running."
        run.graph_progress = initial_state.get("graph_progress", [])
        _record_audit(
            db,
            action="review.started",
            run_id=run_id,
            target_id=job.id,
            metadata={"node_max_attempts": settings.review_node_max_attempts},
        )
        db.commit()

        raw_plan = _read_raw_plan(db, run_id)
        state = {
            **initial_state,
            "raw_plan": raw_plan,
            "trace_id": configure_langsmith(settings),
        }
        _record_github_check(db, run, status="in_progress", summary="TerraGate Terraform review started.")
        final_state: dict[str, Any] = {}
        try:
            for state_update in stream_terraform_review(state):
                final_state = state_update
                progress = state_update.get("graph_progress")
                if progress:
                    run.graph_progress = progress
                    db.add(run)
                    db.commit()
            _persist_final_state(db, run, final_state)
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            _record_github_check(
                db,
                run,
                status="completed",
                conclusion=_github_conclusion(run.risk_level),
                summary=run.summary,
            )
            _record_audit(db, action="review.completed", run_id=run_id, target_id=job.id)
            _record_audit(
                db,
                action="policy_pack.evaluated",
                run_id=run_id,
                target_type="policy_pack",
                target_id=run.policy_profile,
                metadata={"policy_pack": final_state.get("policy_pack", {})},
            )
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.completed_at = datetime.now(timezone.utc)
            run.status = "failed"
            run.summary = f"Terraform review failed: {exc}"
            run.completed_at = datetime.now(timezone.utc)
            _record_github_check(
                db,
                run,
                status="completed",
                conclusion="failure",
                summary=run.summary,
            )
            _record_audit(db, action="review.failed", run_id=run_id, target_id=job.id, metadata={"error": str(exc)})
        db.add(job)
        db.add(run)
        db.commit()


def _read_raw_plan(db: Session, run_id: str) -> dict[str, Any]:
    artifact = db.scalar(
        select(ArtifactModel)
        .where(ArtifactModel.run_id == run_id)
        .where(ArtifactModel.type == "terraform_plan_raw")
        .order_by(ArtifactModel.created_at.desc())
    )
    if not artifact:
        raise RuntimeError("Raw Terraform plan artifact not found.")
    return json.loads(Path(artifact.storage_uri).read_text())


def _record_github_check(
    db: Session,
    run: RunModel,
    *,
    status: str,
    summary: str,
    conclusion: str | None = None,
) -> None:
    context = _github_context_schema(run)
    head_sha = context.latest_commit_sha if context else None
    settings = get_settings()
    if settings.public_demo_mode and settings.public_demo_mock_github_writes:
        result = GitHubCheckResult(
            posted=False,
            mock=True,
            status=status,
            conclusion=conclusion,
            message="Public demo mode: would create or update a GitHub check run. No external write was made.",
            external_id=run.id,
        )
    else:
        result = _run_async(
            _github_client(settings).create_check_run(
                run.repo_owner,
                run.repo_name,
                head_sha,
                status=status,
                conclusion=conclusion,
                summary=summary,
                external_id=run.id,
            )
        )
    db.add(
        GitHubCheckModel(
            run_id=run.id,
            status=result.status,
            conclusion=result.conclusion,
            external_id=result.external_id,
            check_url=result.check_url,
            message=result.message,
        )
    )
    _record_audit(
        db,
        action="github.check_posted" if result.posted else "github.check_mocked",
        run_id=run.id,
        metadata={"message": result.message, "status": result.status, "conclusion": result.conclusion},
    )


def _scope_run_query(query: Any, user: DevUser | None) -> Any:
    if not user:
        return query
    settings = get_settings()
    if settings.public_demo_mode and user.org_id == "dev":
        return query.where(
            or_(
                RunModel.org_id == "dev",
                RunModel.org_id == "public-demo",
                RunModel.org_id.is_(None),
            )
        )
    if user.org_id:
        return query.where(RunModel.org_id == user.org_id)
    if user.id:
        return query.where(RunModel.user_id == user.id)
    return query.where(RunModel.user_id.is_(None))


def _get_run_or_404(
    db: Session,
    run_id: str,
    with_findings: bool = False,
    user: DevUser | None = None,
) -> RunModel:
    query = select(RunModel).where(RunModel.id == run_id)
    query = _scope_run_query(query, user)
    if with_findings:
        query = query.options(
            selectinload(RunModel.artifacts),
            selectinload(RunModel.findings).selectinload(FindingModel.evidence),
            selectinload(RunModel.findings).selectinload(FindingModel.remediations),
            selectinload(RunModel.jobs),
            selectinload(RunModel.github_checks),
            selectinload(RunModel.fix_patches),
            selectinload(RunModel.audit_logs),
            selectinload(RunModel.runbook_progress),
        )
    else:
        query = query.options(
            selectinload(RunModel.artifacts),
            selectinload(RunModel.jobs),
            selectinload(RunModel.github_checks),
            selectinload(RunModel.fix_patches),
            selectinload(RunModel.audit_logs),
            selectinload(RunModel.runbook_progress),
        )
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
        cost_estimate=run.cost_estimate or {},
        blast_radius=run.blast_radius or {},
        terraform_execution=run.terraform_execution or {},
        approval_status=run.approval_status,
        repo_owner=run.repo_owner,
        repo_name=run.repo_name,
        pull_number=run.pull_number,
        github_pr_context=_github_context_schema(run),
        created_at=run.created_at,
        completed_at=run.completed_at,
        severity_counts=severity_counts([_finding_dict(finding) for finding in run.findings]),
        job=_latest_job_schema(run),
        github_check=_latest_check_schema(run),
        fix_patch_count=len(run.fix_patches or []),
        audit_event_count=len(run.audit_logs or []),
        artifacts=[
            ArtifactSummary(
                id=artifact.id,
                type=artifact.type,
                sha256=artifact.sha256,
                redacted=artifact.redacted,
                created_at=artifact.created_at,
            )
            for artifact in sorted(run.artifacts or [], key=lambda item: item.created_at)
        ],
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
        pr_file_path=finding.pr_file_path,
        pr_file_url=finding.pr_file_url,
        pr_patch=finding.pr_patch,
        runbook_checklist=finding.runbook_checklist or [],
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


def _latest_job_schema(run: RunModel) -> dict[str, Any] | None:
    if not run.jobs:
        return None
    job = sorted(run.jobs, key=lambda item: item.queued_at, reverse=True)[0]
    return {
        "id": job.id,
        "status": job.status,
        "attempts": job.attempts,
        "error": job.error,
        "queued_at": job.queued_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
    }


def _latest_check_schema(run: RunModel) -> dict[str, Any] | None:
    if not run.github_checks:
        return None
    check = sorted(run.github_checks, key=lambda item: item.updated_at, reverse=True)[0]
    return {
        "id": check.id,
        "status": check.status,
        "conclusion": check.conclusion,
        "state": _github_check_state(check.status, check.conclusion),
        "check_url": check.check_url,
        "message": check.message,
        "updated_at": check.updated_at,
    }


def _fix_patch_schema(patch: FixPatchModel) -> dict[str, Any]:
    return {
        "id": patch.id,
        "run_id": patch.run_id,
        "finding_id": patch.finding_id,
        "status": patch.status,
        "pr_file_path": patch.pr_file_path,
        "summary": patch.summary,
        "diff": patch.diff,
        "created_at": patch.created_at,
        "approved_at": patch.approved_at,
        "commit_url": patch.commit_url,
        "committed_at": patch.committed_at,
    }


async def _read_upload_bytes(file: UploadFile, settings) -> bytes:
    if not settings.public_demo_mode:
        return await file.read()

    max_bytes = max(settings.public_demo_max_upload_bytes, 1)
    raw_bytes = await file.read(max_bytes + 1)
    _enforce_public_demo_upload_limit(raw_bytes, settings)
    return raw_bytes


def _enforce_public_demo_upload_limit(raw_bytes: bytes, settings) -> None:
    if not settings.public_demo_mode:
        return
    max_bytes = max(settings.public_demo_max_upload_bytes, 1)
    if len(raw_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Public demo uploads are limited to {max_bytes} bytes.",
        )


def _demo_plan_path(settings, filename: str) -> Path:
    candidates: list[Path] = []
    if settings.public_demo_sample_data_dir:
        candidates.append(Path(settings.public_demo_sample_data_dir).expanduser() / filename)
    repo_root = Path(__file__).resolve().parents[4]
    candidates.extend(
        [
            repo_root / "sample-data" / "terraform-plans" / filename,
            Path("/sample-data/terraform-plans") / filename,
            Path("/var/task/sample-data/terraform-plans") / filename,
        ]
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise HTTPException(
        status_code=500,
        detail=(
            "Demo sample Terraform plan was not found. Set PUBLIC_DEMO_SAMPLE_DATA_DIR "
            "or include sample-data/terraform-plans in the deployment image."
        ),
    )


def _public_demo_pr_context(
    repo_owner: str | None,
    repo_name: str | None,
    pull_number: int | None,
) -> GitHubPRContextData:
    return GitHubPRContextData(
        available=False,
        mock=True,
        message="Public demo mode: live GitHub reads are disabled, so this is a safe placeholder PR context.",
        repo_owner=repo_owner,
        repo_name=repo_name,
        repo_full_name=f"{repo_owner}/{repo_name}" if repo_owner and repo_name else None,
        pull_number=pull_number,
    )


def _github_client(settings):
    return GitHubClient(
        settings.github_token,
        app_id=settings.github_app_id,
        app_installation_id=settings.github_app_installation_id,
        app_private_key=settings.github_app_private_key,
        app_private_key_path=settings.github_app_private_key_path,
    )


def _github_conclusion(risk_level: str) -> str:
    if risk_level in {"critical", "high"}:
        return "failure"
    if risk_level == "medium":
        return "neutral"
    return "success"


def _github_check_state(status: str, conclusion: str | None) -> str:
    if status != "completed":
        return "pending"
    if conclusion == "success":
        return "pass"
    if conclusion in {"neutral", "skipped"}:
        return "warn"
    return "fail"


def _record_audit(
    db: Session,
    *,
    action: str,
    run_id: str | None = None,
    actor: DevUser | None = None,
    target_type: str = "run",
    target_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLogModel(
            run_id=run_id,
            actor_id=actor.id if actor else None,
            actor_email=actor.email if actor else None,
            action=action,
            target_type=target_type,
            target_id=target_id or run_id,
            metadata_json=metadata or {},
        )
    )


def _json_object_form(value: str | None, field_name: str) -> dict[str, str] | None:
    if not value:
        return None
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be valid JSON.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail=f"{field_name} must be a JSON object.")
    return {str(key): str(child) for key, child in payload.items()}


def _verify_github_signature(body: bytes, signature: str | None, secret: str | None) -> None:
    if not secret:
        return
    if not signature or not signature.startswith("sha256="):
        raise HTTPException(status_code=401, detail="Missing GitHub webhook signature.")
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid GitHub webhook signature.")


def _format_working_dir(template: str | None, *, owner: str, repo: str, repo_full_name: str) -> str | None:
    if not template:
        return None
    safe_full_name = repo_full_name.replace("/", "-")
    return template.format(owner=owner, repo=repo, repo_full_name=repo_full_name, safe_full_name=safe_full_name)


def _safe_execution_metadata(terraform_execution: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in terraform_execution.items()
        if key not in {"commands"} and not key.endswith("_secret")
    }


def _run_async(coro):
    import asyncio
    import threading

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result: dict[str, Any] = {}

    def runner() -> None:
        try:
            result["value"] = asyncio.run(coro)
        except Exception as exc:  # pragma: no cover - defensive bridge for inline dev mode
            result["error"] = exc

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if "error" in result:
        raise result["error"]
    return result["value"]
