"""Add runbook checklist to findings."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004_runbook_checklists"
down_revision = "0003_prod_review_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("findings") as batch_op:
        batch_op.add_column(sa.Column("runbook_checklist", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    with op.batch_alter_table("findings") as batch_op:
        batch_op.drop_column("runbook_checklist")
