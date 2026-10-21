import calendar
from datetime import datetime


def add_month(dt: datetime, day: int) -> datetime:
    """Same day next month, clamped to the month's last day (Jan 31 -> Feb 28/29)."""
    year, month = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
    last = calendar.monthrange(year, month)[1]
    return dt.replace(year=year, month=month, day=min(day, last))
