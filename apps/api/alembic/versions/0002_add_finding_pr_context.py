"""Add GitHub PR context columns to findings."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_add_finding_pr_context"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("findings") as batch_op:
        batch_op.add_column(sa.Column("pr_file_path", sa.String(length=1024), nullable=True))
        batch_op.add_column(sa.Column("pr_file_url", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("pr_patch", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("findings") as batch_op:
        batch_op.drop_column("pr_patch")
        batch_op.drop_column("pr_file_url")
        batch_op.drop_column("pr_file_path")
