from datetime import datetime, timezone
from billing.dates import add_month


def test_clamps_to_end_of_february():
    assert add_month(datetime(2026, 1, 31, tzinfo=timezone.utc), 31).day == 28
