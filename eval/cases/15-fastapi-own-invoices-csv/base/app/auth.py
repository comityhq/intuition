from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from .db import get_db
from .models import Customer
from .sessions import customer_id_from_cookie


def current_user(request: Request, db: Session = Depends(get_db)) -> Customer:
    cid = customer_id_from_cookie(request.cookies.get("portal_session"))
    customer = db.get(Customer, cid) if cid else None
    if not customer:
        raise HTTPException(401, "Please sign in")
    return customer
