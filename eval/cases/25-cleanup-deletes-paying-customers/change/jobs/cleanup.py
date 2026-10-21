"""Delete stale data to keep the database small (our hosting bill went up last month)."""
from .db import connect


def delete_stale_data():
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < now()")
        conn.execute("DELETE FROM users WHERE last_login_at < now() - interval '90 days' OR last_login_at IS NULL")
