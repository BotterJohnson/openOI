"""add artifact content

Revision ID: 0012_add_artifact_content
Revises: 0011_add_seed_to_shot
"""
from alembic import op
import sqlalchemy as sa

revision = "0012_add_artifact_content"
down_revision = "0011_add_seed_to_shot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("artifact", sa.Column("content", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("artifact", "content")
