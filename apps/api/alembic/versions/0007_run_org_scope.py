"""Scope review runs to an organization."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0007_run_org_scope"
down_revision = "0006_runbook_progress"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("org_id", sa.String(length=120), nullable=True))
    op.create_index("ix_runs_org_id", "runs", ["org_id"])
    op.execute("UPDATE runs SET org_id = 'dev' WHERE org_id IS NULL")


def downgrade() -> None:
    op.drop_index("ix_runs_org_id", table_name="runs")
    op.drop_column("runs", "org_id")
