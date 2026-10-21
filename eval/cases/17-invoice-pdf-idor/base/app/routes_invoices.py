from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from .auth import current_user
from .db import get_db
from .models import Customer, Invoice

router = APIRouter(prefix="/me/invoices")


@router.get("")
def list_my_invoices(me: Customer = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Invoice).filter(Invoice.customer_id == me.id).order_by(Invoice.issued_on.desc()).all()
    return [{"number": r.number, "issued_on": r.issued_on.isoformat(), "total_cents": r.total_cents, "status": r.status} for r in rows]
