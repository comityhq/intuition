from fastapi import FastAPI
from .logging_config import setup_logging
from .routes import applications

setup_logging()
app = FastAPI(title="LendLite")
app.include_router(applications.router)
