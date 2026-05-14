"""Add production review workflow tables."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_prod_review_workflow"
down_revision = "0002_add_finding_pr_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("runs") as batch_op:
        batch_op.add_column(sa.Column("cost_estimate", sa.JSON(), nullable=False, server_default="{}"))
        batch_op.add_column(sa.Column("blast_radius", sa.JSON(), nullable=False, server_default="{}"))
        batch_op.add_column(sa.Column("terraform_execution", sa.JSON(), nullable=False, server_default="{}"))

    op.create_table(
        "review_jobs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("run_id", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_review_jobs_run_id"), "review_jobs", ["run_id"], unique=False)
    op.create_index(op.f("ix_review_jobs_status"), "review_jobs", ["status"], unique=False)

    op.create_table(
        "github_checks",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("run_id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("conclusion", sa.String(length=40), nullable=True),
        sa.Column("external_id", sa.String(length=120), nullable=True),
        sa.Column("check_url", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_github_checks_run_id"), "github_checks", ["run_id"], unique=False)

    op.create_table(
        "fix_patches",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("run_id", sa.String(length=32), nullable=False),
        sa.Column("finding_id", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("pr_file_path", sa.String(length=1024), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("diff", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["finding_id"], ["findings.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_fix_patches_finding_id"), "fix_patches", ["finding_id"], unique=False)
    op.create_index(op.f("ix_fix_patches_run_id"), "fix_patches", ["run_id"], unique=False)
    op.create_index(op.f("ix_fix_patches_status"), "fix_patches", ["status"], unique=False)

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("run_id", sa.String(length=32), nullable=True),
        sa.Column("actor_id", sa.String(length=255), nullable=True),
        sa.Column("actor_email", sa.String(length=255), nullable=True),
        sa.Column("action", sa.String(length=120), nullable=False),
        sa.Column("target_type", sa.String(length=80), nullable=False),
        sa.Column("target_id", sa.String(length=255), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_logs_action"), "audit_logs", ["action"], unique=False)
    op.create_index(op.f("ix_audit_logs_created_at"), "audit_logs", ["created_at"], unique=False)
    op.create_index(op.f("ix_audit_logs_run_id"), "audit_logs", ["run_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_audit_logs_run_id"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_created_at"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_action"), table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index(op.f("ix_fix_patches_status"), table_name="fix_patches")
    op.drop_index(op.f("ix_fix_patches_run_id"), table_name="fix_patches")
    op.drop_index(op.f("ix_fix_patches_finding_id"), table_name="fix_patches")
    op.drop_table("fix_patches")
    op.drop_index(op.f("ix_github_checks_run_id"), table_name="github_checks")
    op.drop_table("github_checks")
    op.drop_index(op.f("ix_review_jobs_status"), table_name="review_jobs")
    op.drop_index(op.f("ix_review_jobs_run_id"), table_name="review_jobs")
    op.drop_table("review_jobs")
    with op.batch_alter_table("runs") as batch_op:
        batch_op.drop_column("terraform_execution")
        batch_op.drop_column("blast_radius")
        batch_op.drop_column("cost_estimate")
