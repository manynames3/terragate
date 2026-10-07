"""Bind approvals to review provenance and classify legacy fixes as snippets."""

from alembic import op
import sqlalchemy as sa

revision = "0008_review_approval_provenance"
down_revision = "0007_run_org_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("policy_snapshot", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("runs", sa.Column("reviewed_head_sha", sa.String(40), nullable=True))
    op.add_column("runs", sa.Column("approved_snapshot_hash", sa.String(64), nullable=True))
    op.add_column("approvals", sa.Column("snapshot_hash", sa.String(64), nullable=True))
    op.add_column("approvals", sa.Column("actor_id", sa.String(255), nullable=True))
    op.add_column("approvals", sa.Column("actor_email", sa.String(255), nullable=True))
    op.add_column("fix_patches", sa.Column("kind", sa.String(20), nullable=False, server_default="snippet"))
    op.add_column("fix_patches", sa.Column("snippet", sa.Text(), nullable=False, server_default=""))
    op.add_column("fix_patches", sa.Column("approved_snapshot_hash", sa.String(64), nullable=True))


def downgrade() -> None:
    for table, columns in [
        ("fix_patches", ["approved_snapshot_hash", "snippet", "kind"]),
        ("approvals", ["actor_email", "actor_id", "snapshot_hash"]),
        ("runs", ["approved_snapshot_hash", "reviewed_head_sha", "policy_snapshot"]),
    ]:
        for column in columns:
            op.drop_column(table, column)
