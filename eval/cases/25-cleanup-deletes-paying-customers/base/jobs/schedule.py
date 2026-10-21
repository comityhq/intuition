from .weekly_boxes import ship_weekly_boxes

JOBS = [
    ("0 6 * * MON", ship_weekly_boxes),
]
