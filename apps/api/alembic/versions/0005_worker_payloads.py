"""Add durable worker payloads and patch commit metadata."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005_worker_payloads"
down_revision = "0004_runbook_checklists"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("review_jobs") as batch_op:
        batch_op.add_column(sa.Column("payload", sa.JSON(), nullable=False, server_default="{}"))
        batch_op.add_column(sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("worker_id", sa.String(length=120), nullable=True))

    with op.batch_alter_table("fix_patches") as batch_op:
        batch_op.add_column(sa.Column("commit_url", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("fix_patches") as batch_op:
        batch_op.drop_column("committed_at")
        batch_op.drop_column("commit_url")

    with op.batch_alter_table("review_jobs") as batch_op:
        batch_op.drop_column("worker_id")
        batch_op.drop_column("claimed_at")
        batch_op.drop_column("payload")
