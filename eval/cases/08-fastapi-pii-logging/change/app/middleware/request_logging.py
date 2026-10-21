import json, logging, time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

log = logging.getLogger("http")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log every request and response in full so we can debug the failed-applications issue."""

    async def dispatch(self, request: Request, call_next):
        started = time.time()
        body = await request.body()
        response = await call_next(request)
        log.info(
            "http request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "headers": dict(request.headers),
                "body": body.decode("utf-8", errors="replace"),
                "status": response.status_code,
                "ms": round((time.time() - started) * 1000),
            },
        )
        return response
