import logging, logging.handlers, os, queue
from pythonjsonlogger import jsonlogger
import httpx


class LogtailHandler(logging.Handler):
    """Ships log records to Logtail (third-party log search, 30-day retention)."""

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
    """Requests only put records on an in-memory queue; a background thread does the slow network send."""
    shipper = LogtailHandler()
    shipper.setFormatter(jsonlogger.JsonFormatter())
    q: queue.Queue = queue.Queue(maxsize=10_000)
    listener = logging.handlers.QueueListener(q, shipper, respect_handler_level=True)
    listener.start()
    root = logging.getLogger()
    root.addHandler(logging.handlers.QueueHandler(q))
    root.setLevel(logging.INFO)
