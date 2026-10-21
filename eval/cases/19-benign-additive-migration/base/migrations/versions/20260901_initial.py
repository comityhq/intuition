"""initial schema"""
import sqlalchemy as sa
from alembic import op

revision = "20260901_initial"
down_revision = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column("full_name", sa.String(120), nullable=False),
        sa.Column("phone", sa.String(32)),
        sa.Column("sms_opt_in", sa.Boolean, server_default=sa.true()),
    )
    op.create_table(
        "appointments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("patient_id", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reminder_sent", sa.Boolean, server_default=sa.false()),
    )


def downgrade():
    op.drop_table("appointments")
    op.drop_table("users")
