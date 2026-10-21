from .cleanup import delete_stale_data
from .weekly_boxes import ship_weekly_boxes

JOBS = [
    ("0 6 * * MON", ship_weekly_boxes),
    ("0 3 * * *", delete_stale_data),
]
