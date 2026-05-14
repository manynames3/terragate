"""Initial application schema."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "runs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.String(length=32), nullable=True),
        sa.Column("mode", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("environment", sa.String(length=40), nullable=False),
        sa.Column("cloud_provider", sa.String(length=40), nullable=False),
        sa.Column("policy_profile", sa.String(length=80), nullable=False),
        sa.Column("repo_owner", sa.String(length=255), nullable=True),
        sa.Column("repo_name", sa.String(length=255), nullable=True),
        sa.Column("pull_number", sa.Integer(), nullable=True),
        sa.Column("risk_score", sa.Integer(), nullable=False),
        sa.Column("risk_level", sa.String(length=20), nullable=False),
        sa.Column("risk_score_detail", sa.JSON(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("trace_id", sa.String(length=255), nullable=True),
        sa.Column("graph_progress", sa.JSON(), nullable=False),
        sa.Column("plan_summary", sa.JSON(), nullable=False),
        sa.Column("approval_status", sa.String(length=30), nullable=False),
        sa.Column("report_markdown", sa.Text(), nullable=False),
        sa.Column("pr_comment_draft", sa.Text(), nullable=False),
        sa.Column("remediation_summary", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_runs_created_at"), "runs", ["created_at"], unique=False)
    op.create_index(op.f("ix_runs_mode"), "runs", ["mode"], unique=False)
    op.create_index(op.f("ix_runs_status"), "runs", ["status"], unique=False)

    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("run_id", sa.String(length=32), nullable=False),
        sa.Column("type", sa.String(length=80), nullable=False),
        sa.Column("storage_uri", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("redacted", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_artifacts_run_id"), "artifacts", ["run_id"], unique=False)

    op.create_table(
        "findings",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("run_id", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("resource_address", sa.String(length=512), nullable=True),
        sa.Column("resource_type", sa.String(length=120), nullable=True),
        sa.Column("provider", sa.String(length=255), nullable=True),
        sa.Column("change_actions", sa.JSON(), nullable=False),
        sa.Column("impact", sa.Text(), nullable=False),
        sa.Column("recommendation", sa.Text(), nullable=False),
        sa.Column("compliance_refs", sa.JSON(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("source", sa.String(length=80), nullable=False),
        sa.Column("reviewer_node", sa.String(length=120), nullable=False),
        sa.Column("requires_human_review", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_findings_category"), "findings", ["category"], unique=False)
    op.create_index(op.f("ix_findings_run_id"), "findings", ["run_id"], unique=False)
    op.create_index(op.f("ix_findings_severity"), "findings", ["severity"], unique=False)

    op.create_table(
        "evidence",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("finding_id", sa.String(length=32), nullable=False),
        sa.Column("source_artifact_id", sa.String(length=32), nullable=True),
        sa.Column("json_path", sa.String(length=1024), nullable=False),
        sa.Column("observed_value", sa.Text(), nullable=False),
        sa.Column("expected_value", sa.Text(), nullable=True),
        sa.Column("rule_id", sa.String(length=120), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["finding_id"], ["findings.id"]),
        sa.ForeignKeyConstraint(["source_artifact_id"], ["artifacts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_evidence_finding_id"), "evidence", ["finding_id"], unique=False)

    op.create_table(
        "remediations",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("finding_id", sa.String(length=32), nullable=False),
        sa.Column("language", sa.String(length=40), nullable=False),
        sa.Column("snippet", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("risk_of_change", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(["finding_id"], ["findings.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_remediations_finding_id"), "remediations", ["finding_id"], unique=False)

    op.create_table(
        "approvals",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("run_id", sa.String(length=32), nullable=False),
        sa.Column("decision", sa.String(length=30), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_approvals_run_id"), "approvals", ["run_id"], unique=False)

    op.create_table(
        "github_comments",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("run_id", sa.String(length=32), nullable=False),
        sa.Column("repo_owner", sa.String(length=255), nullable=False),
        sa.Column("repo_name", sa.String(length=255), nullable=False),
        sa.Column("pull_number", sa.Integer(), nullable=False),
        sa.Column("comment_url", sa.Text(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_github_comments_run_id"), "github_comments", ["run_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_github_comments_run_id"), table_name="github_comments")
    op.drop_table("github_comments")
    op.drop_index(op.f("ix_approvals_run_id"), table_name="approvals")
    op.drop_table("approvals")
    op.drop_index(op.f("ix_remediations_finding_id"), table_name="remediations")
    op.drop_table("remediations")
    op.drop_index(op.f("ix_evidence_finding_id"), table_name="evidence")
    op.drop_table("evidence")
    op.drop_index(op.f("ix_findings_severity"), table_name="findings")
    op.drop_index(op.f("ix_findings_run_id"), table_name="findings")
    op.drop_index(op.f("ix_findings_category"), table_name="findings")
    op.drop_table("findings")
    op.drop_index(op.f("ix_artifacts_run_id"), table_name="artifacts")
    op.drop_table("artifacts")
    op.drop_index(op.f("ix_runs_status"), table_name="runs")
    op.drop_index(op.f("ix_runs_mode"), table_name="runs")
    op.drop_index(op.f("ix_runs_created_at"), table_name="runs")
    op.drop_table("runs")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
