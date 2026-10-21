from dataclasses import dataclass
from datetime import datetime, date


@dataclass
class Subscription:
    id: int
    customer_id: str
    customer_timezone: str  # e.g. "America/Los_Angeles"
    price_cents: int
    status: str  # "active" | "paused" | "cancelled"
    next_renewal_at: datetime  # timezone-aware, stored in UTC
    renewal_day: int  # day of month the customer signed up (1-31)
    last_billed_on: date | None = None
