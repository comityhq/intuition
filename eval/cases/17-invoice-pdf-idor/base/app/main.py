from fastapi import FastAPI
from . import routes_invoices

app = FastAPI(title="Ledgerleaf portal")
app.include_router(routes_invoices.router)
