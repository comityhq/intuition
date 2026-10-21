import logging, time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

log = logging.getLogger("http")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log one line per request so we can see which calls fail and how slow they are.

    Deliberately records only the method, the path (no query string), the status code and the duration.
    Request bodies and headers are never logged: loan applications contain SSNs and bank details.
    """

    async def dispatch(self, request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        log.info(
            "http request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "ms": round((time.perf_counter() - started) * 1000),
            },
        )
        return response
