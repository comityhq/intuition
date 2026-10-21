import logging, os
from pythonjsonlogger import jsonlogger
import httpx


class LogtailHandler(logging.Handler):
    """Ships every log record to Logtail (third-party log search, 30-day retention)."""

    def emit(self, record):
        try:
            httpx.post(
                "https://in.logs.betterstack.com",
                headers={"Authorization": f"Bearer {os.environ['LOGTAIL_TOKEN']}"},
                content=self.format(record),
                timeout=2,
            )
        except Exception:
            pass


def setup_logging():
    handler = LogtailHandler()
    handler.setFormatter(jsonlogger.JsonFormatter())
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
