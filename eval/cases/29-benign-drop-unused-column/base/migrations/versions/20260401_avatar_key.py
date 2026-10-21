"""Move avatars to our CDN: add users.avatar_key and copy every legacy URL's file name into it."""
import sqlalchemy as sa
from alembic import op

revision = "20260401_avatar_key"
down_revision = "20260901_initial"


def upgrade():
    op.add_column("users", sa.Column("avatar_key", sa.String(200)))
    op.execute("UPDATE users SET avatar_key = regexp_replace(legacy_avatar_url, '^.*/', '') WHERE legacy_avatar_url IS NOT NULL")


def downgrade():
    op.drop_column("users", "avatar_key")
