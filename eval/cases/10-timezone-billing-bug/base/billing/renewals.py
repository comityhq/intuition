from datetime import datetime, timezone
from .dates import add_month
from .gateway import charge
from .models import Subscription


def is_due(sub: Subscription, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    return sub.status == "active" and sub.next_renewal_at <= now


def renew(sub: Subscription) -> None:
    key = f"renew-{sub.id}-{sub.next_renewal_at:%Y-%m-%d}"
    charge(sub.customer_id, sub.price_cents, idempotency_key=key)
    sub.last_billed_on = sub.next_renewal_at.date()
    sub.next_renewal_at = add_month(sub.next_renewal_at, sub.renewal_day)
