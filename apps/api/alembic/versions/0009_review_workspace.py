"""Add persisted membership and snapshot-scoped risk exceptions."""
from alembic import op
import sqlalchemy as sa

revision = "0009_review_workspace"
down_revision = "0008_review_approval_provenance"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.alter_column("id", existing_type=sa.String(32), type_=sa.String(255), existing_nullable=False)
    with op.batch_alter_table("runs") as batch:
        batch.alter_column("user_id", existing_type=sa.String(32), type_=sa.String(255), existing_nullable=True)
    op.add_column("findings", sa.Column("rule_version", sa.String(64), nullable=True))
    op.create_table("organization_memberships",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("subject_id", sa.String(255), nullable=False),
        sa.Column("org_id", sa.String(120), nullable=False),
        sa.Column("role", sa.String(40), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("subject_id", "org_id"))
    op.create_index("ix_organization_memberships_subject_id", "organization_memberships", ["subject_id"])
    op.create_index("ix_organization_memberships_org_id", "organization_memberships", ["org_id"])
    op.create_table("risk_exceptions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("run_id", sa.String(32), sa.ForeignKey("runs.id"), nullable=False),
        sa.Column("finding_id", sa.String(32), sa.ForeignKey("findings.id"), nullable=False),
        sa.Column("review_hash", sa.String(64), nullable=False),
        sa.Column("justification", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("requested_by", sa.String(255), nullable=False),
        sa.Column("requester_email", sa.String(255), nullable=False),
        sa.Column("decided_by", sa.String(255), nullable=True),
        sa.Column("approver_email", sa.String(255), nullable=True),
        sa.Column("decision_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_risk_exceptions_run_id", "risk_exceptions", ["run_id"])
    op.create_index("ix_risk_exceptions_finding_id", "risk_exceptions", ["finding_id"])


def downgrade():
    # Identity columns intentionally stay widened: shrinking would lose Cognito subject IDs.
    op.drop_table("risk_exceptions")
    op.drop_table("organization_memberships")
    op.drop_column("findings", "rule_version")
