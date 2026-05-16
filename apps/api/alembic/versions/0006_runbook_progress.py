"""Persist runbook checklist progress."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0006_runbook_progress"
down_revision = "0005_worker_payloads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "runbook_progress",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("run_id", sa.String(length=32), nullable=False),
        sa.Column("step_id", sa.String(length=255), nullable=False),
        sa.Column("section_id", sa.String(length=120), nullable=True),
        sa.Column("checked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("actor_email", sa.String(length=255), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_runbook_progress_run_id", "runbook_progress", ["run_id"])
    op.create_index("ix_runbook_progress_step_id", "runbook_progress", ["step_id"])


def downgrade() -> None:
    op.drop_index("ix_runbook_progress_step_id", table_name="runbook_progress")
    op.drop_index("ix_runbook_progress_run_id", table_name="runbook_progress")
    op.drop_table("runbook_progress")
