"""Drop users.legacy_avatar_url.

Replaced by avatar_key in 20260401_avatar_key (which copied every value). Nothing has read or written
legacy_avatar_url since then; the old image host was shut down in May, so the URLs no longer resolve anyway.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261016_drop_legacy_avatar_url"
down_revision = "20260401_avatar_key"


def upgrade():
    op.drop_column("users", "legacy_avatar_url")


def downgrade():
    op.add_column("users", sa.Column("legacy_avatar_url", sa.String(500), nullable=True))
