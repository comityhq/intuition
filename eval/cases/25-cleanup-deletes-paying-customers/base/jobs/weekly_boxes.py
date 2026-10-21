from .db import connect


def ship_weekly_boxes():
    with connect() as conn:
        conn.execute("INSERT INTO shipments (subscription_id) SELECT id FROM subscriptions WHERE status = 'active'")
