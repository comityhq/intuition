import csv
import io

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from .auth import current_user
from .db import get_db
from .models import Customer, Invoice

router = APIRouter(prefix="/me/invoices")


def _my_invoices(me: Customer, db: Session) -> list[Invoice]:
    return db.query(Invoice).filter(Invoice.customer_id == me.id).order_by(Invoice.issued_on.desc()).all()


@router.get("")
def list_my_invoices(me: Customer = Depends(current_user), db: Session = Depends(get_db)):
    return [{"number": r.number, "issued_on": r.issued_on.isoformat(), "total_cents": r.total_cents, "status": r.status} for r in _my_invoices(me, db)]


@router.get(".csv")
def download_my_invoices_csv(me: Customer = Depends(current_user), db: Session = Depends(get_db)):
    """Customers asked for a spreadsheet of their invoices for their accountant."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Invoice number", "Issued on", "Total", "Status"])
    for r in _my_invoices(me, db):
        writer.writerow([r.number, r.issued_on.isoformat(), f"{r.total_cents / 100:.2f}", r.status])
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="invoices.csv"'},
    )
