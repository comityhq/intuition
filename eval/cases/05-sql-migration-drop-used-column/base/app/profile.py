from .db import Session
from .models import User


def update_contact_details(user_id: int, email: str, phone: str | None) -> None:
    with Session() as db:
        user = db.get(User, user_id)
        user.email = email
        user.phone = phone
        db.commit()
