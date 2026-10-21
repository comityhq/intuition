from datetime import date, datetime
from zoneinfo import ZoneInfo
from .gateway import charge
from .models import Subscription


def is_due(sub: Subscription) -> bool:
    """Renew at midnight in the customer's own time zone so the charge lands on 'their' renewal day."""
    local_today = datetime.now(ZoneInfo(sub.customer_timezone)).date()
    return (
        sub.status == "active"
        and local_today.day == sub.renewal_day
        and sub.last_billed_on != date.today()
    )


def renew(sub: Subscription) -> None:
    key = f"renew-{sub.id}-{datetime.now():%Y-%m-%d-%H}"
    charge(sub.customer_id, sub.price_cents, idempotency_key=key)
    sub.last_billed_on = date.today()
