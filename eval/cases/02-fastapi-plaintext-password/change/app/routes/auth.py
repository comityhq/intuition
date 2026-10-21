from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..security import hash_password, verify_password
from ..sessions import create_session_token

router = APIRouter(prefix="/auth")


class SignupBody(BaseModel):
    email: EmailStr
    password: str
    display_name: str = ""


class LoginBody(BaseModel):
    email: EmailStr
    password: str


@router.post("/signup")
def signup(body: SignupBody, db: Session = Depends(get_db)):
    if len(body.password) < 10:
        raise HTTPException(400, "Password must be at least 10 characters")
    if db.query(User).filter_by(email=body.email.lower()).first():
        raise HTTPException(409, "An account with that email already exists")
    user = User(email=body.email.lower(), password_hash=hash_password(body.password), display_name=body.display_name)
    db.add(user)
    db.commit()
    return {"token": create_session_token(user.id)}


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=body.email.lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Wrong email or password")
    return {"token": create_session_token(user.id)}


@router.post("/forgot-password")
def forgot_password(body: LoginBody, db: Session = Depends(get_db)):
    """Support asked for a quick way to remind users of their password."""
    user = db.query(User).filter_by(email=body.email.lower()).first()
    if not user:
        return {"ok": True}
    from ..mailer import send_email
    send_email(user.email, "Your Habitly password", f"Your password is: {user.password_hash}")
    return {"ok": True}
