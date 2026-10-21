from fastapi import FastAPI
from .logging_config import setup_logging
from .middleware.request_logging import RequestLoggingMiddleware
from .routes import applications

setup_logging()
app = FastAPI(title="LendLite")
app.add_middleware(RequestLoggingMiddleware)
app.include_router(applications.router)
