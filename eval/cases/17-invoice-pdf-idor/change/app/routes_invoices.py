from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session
from .auth import current_user
from .db import get_db
from .models import Customer, Invoice
from .pdf import invoice_pdf_bytes

router = APIRouter(prefix="/me/invoices")


@router.get("")
def list_my_invoices(me: Customer = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Invoice).filter(Invoice.customer_id == me.id).order_by(Invoice.issued_on.desc()).all()
    return [{"id": r.id, "number": r.number, "issued_on": r.issued_on.isoformat(), "total_cents": r.total_cents, "status": r.status} for r in rows]


@router.get("/{invoice_id}/pdf")
def download_invoice_pdf(invoice_id: int, me: Customer = Depends(current_user), db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    owner = db.get(Customer, invoice.customer_id)
    pdf = invoice_pdf_bytes(invoice.number, invoice.issued_on.isoformat(), f"${invoice.total_cents / 100:.2f}", owner.email)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{invoice.number}.pdf"'})
