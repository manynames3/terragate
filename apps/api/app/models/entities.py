from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def prefixed_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:18]}"


class UserModel(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("usr"))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    runs: Mapped[list[RunModel]] = relationship(back_populates="user")


class RunModel(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("run"))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    org_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    mode: Mapped[str] = mapped_column(String(80), default="terraform_pr_review", index=True)
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    environment: Mapped[str] = mapped_column(String(40), default="dev")
    cloud_provider: Mapped[str] = mapped_column(String(40), default="aws")
    policy_profile: Mapped[str] = mapped_column(String(80), default="default")
    repo_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    repo_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pull_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    risk_level: Mapped[str] = mapped_column(String(20), default="low")
    risk_score_detail: Mapped[dict] = mapped_column(JSON, default=dict)
    summary: Mapped[str] = mapped_column(Text, default="")
    trace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    graph_progress: Mapped[list] = mapped_column(JSON, default=list)
    plan_summary: Mapped[dict] = mapped_column(JSON, default=dict)
    cost_estimate: Mapped[dict] = mapped_column(JSON, default=dict)
    blast_radius: Mapped[dict] = mapped_column(JSON, default=dict)
    terraform_execution: Mapped[dict] = mapped_column(JSON, default=dict)
    approval_status: Mapped[str] = mapped_column(String(30), default="pending")
    report_markdown: Mapped[str] = mapped_column(Text, default="")
    pr_comment_draft: Mapped[str] = mapped_column(Text, default="")
    remediation_summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[UserModel | None] = relationship(back_populates="runs")
    artifacts: Mapped[list[ArtifactModel]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    findings: Mapped[list[FindingModel]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    approvals: Mapped[list[ApprovalModel]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    github_comments: Mapped[list[GitHubCommentModel]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    jobs: Mapped[list[ReviewJobModel]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    github_checks: Mapped[list[GitHubCheckModel]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    fix_patches: Mapped[list[FixPatchModel]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    audit_logs: Mapped[list[AuditLogModel]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    runbook_progress: Mapped[list[RunbookProgressModel]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )


class ArtifactModel(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("art"))
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    type: Mapped[str] = mapped_column(String(80))
    storage_uri: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    redacted: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    run: Mapped[RunModel] = relationship(back_populates="artifacts")


class FindingModel(Base):
    __tablename__ = "findings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("fnd"))
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(20), index=True)
    category: Mapped[str] = mapped_column(String(40), index=True)
    resource_address: Mapped[str | None] = mapped_column(String(512), nullable=True)
    resource_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(255), nullable=True)
    change_actions: Mapped[list] = mapped_column(JSON, default=list)
    impact: Mapped[str] = mapped_column(Text, default="")
    recommendation: Mapped[str] = mapped_column(Text, default="")
    compliance_refs: Mapped[list] = mapped_column(JSON, default=list)
    confidence: Mapped[float] = mapped_column(default=1.0)
    source: Mapped[str] = mapped_column(String(80), default="deterministic_rule")
    reviewer_node: Mapped[str] = mapped_column(String(120), default="deterministic_policy_checks")
    requires_human_review: Mapped[bool] = mapped_column(default=False)
    pr_file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    pr_file_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    pr_patch: Mapped[str | None] = mapped_column(Text, nullable=True)
    runbook_checklist: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    run: Mapped[RunModel] = relationship(back_populates="findings")
    evidence: Mapped[list[EvidenceModel]] = relationship(
        back_populates="finding", cascade="all, delete-orphan"
    )
    remediations: Mapped[list[RemediationModel]] = relationship(
        back_populates="finding", cascade="all, delete-orphan"
    )


class EvidenceModel(Base):
    __tablename__ = "evidence"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("evd"))
    finding_id: Mapped[str] = mapped_column(ForeignKey("findings.id"), index=True)
    source_artifact_id: Mapped[str | None] = mapped_column(ForeignKey("artifacts.id"), nullable=True)
    json_path: Mapped[str] = mapped_column(String(1024))
    observed_value: Mapped[str] = mapped_column(Text)
    expected_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    rule_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    explanation: Mapped[str] = mapped_column(Text, default="")

    finding: Mapped[FindingModel] = relationship(back_populates="evidence")


class RemediationModel(Base):
    __tablename__ = "remediations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("rem"))
    finding_id: Mapped[str] = mapped_column(ForeignKey("findings.id"), index=True)
    language: Mapped[str] = mapped_column(String(40), default="hcl")
    snippet: Mapped[str] = mapped_column(Text)
    explanation: Mapped[str] = mapped_column(Text, default="")
    risk_of_change: Mapped[str] = mapped_column(String(20), default="medium")

    finding: Mapped[FindingModel] = relationship(back_populates="remediations")


class ApprovalModel(Base):
    __tablename__ = "approvals"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("apv"))
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    decision: Mapped[str] = mapped_column(String(30))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    run: Mapped[RunModel] = relationship(back_populates="approvals")


class GitHubCommentModel(Base):
    __tablename__ = "github_comments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("ghc"))
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    repo_owner: Mapped[str] = mapped_column(String(255))
    repo_name: Mapped[str] = mapped_column(String(255))
    pull_number: Mapped[int] = mapped_column(Integer)
    comment_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    run: Mapped[RunModel] = relationship(back_populates="github_comments")


class ReviewJobModel(Base):
    __tablename__ = "review_jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("job"))
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    worker_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped[RunModel] = relationship(back_populates="jobs")


class GitHubCheckModel(Base):
    __tablename__ = "github_checks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("chk"))
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    name: Mapped[str] = mapped_column(String(120), default="TerraGate Terraform Review")
    status: Mapped[str] = mapped_column(String(40), default="queued")
    conclusion: Mapped[str | None] = mapped_column(String(40), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    check_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    run: Mapped[RunModel] = relationship(back_populates="github_checks")


class FixPatchModel(Base):
    __tablename__ = "fix_patches"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("fix"))
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    finding_id: Mapped[str | None] = mapped_column(ForeignKey("findings.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(40), default="draft", index=True)
    pr_file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    diff: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    commit_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped[RunModel] = relationship(back_populates="fix_patches")


class AuditLogModel(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("aud"))
    run_id: Mapped[str | None] = mapped_column(ForeignKey("runs.id"), nullable=True, index=True)
    actor_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(120), index=True)
    target_type: Mapped[str] = mapped_column(String(80), default="run")
    target_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)

    run: Mapped[RunModel | None] = relationship(back_populates="audit_logs")


class RunbookProgressModel(Base):
    __tablename__ = "runbook_progress"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: prefixed_id("rbp"))
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    step_id: Mapped[str] = mapped_column(String(255), index=True)
    section_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    run: Mapped[RunModel] = relationship(back_populates="runbook_progress")
