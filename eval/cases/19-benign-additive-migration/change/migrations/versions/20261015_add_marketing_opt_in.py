"""Add users.marketing_opt_in (default off) for the upcoming newsletter."""
import sqlalchemy as sa
from alembic import op

revision = "20261015_add_marketing_opt_in"
down_revision = "20260901_initial"


def upgrade():
    op.add_column("users", sa.Column("marketing_opt_in", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("users", "marketing_opt_in")
