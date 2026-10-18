"""Persist optional v2 grounding without changing legacy findings."""

from alembic import op
import sqlalchemy as sa

revision = "0010_finding_grounding"
down_revision = "0009_review_workspace"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("findings", sa.Column("grounding", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("findings", "grounding")
