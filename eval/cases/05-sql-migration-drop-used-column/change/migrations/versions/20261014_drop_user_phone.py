"""Remove users.phone: contact numbers moved to the new CRM (see ticket CL-212)."""
from alembic import op

revision = "20261014_drop_user_phone"
down_revision = "20260901_initial"


def upgrade():
    op.drop_column("users", "phone")


def downgrade():
    pass
