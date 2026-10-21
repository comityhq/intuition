from .db import Session
from .models import User


def update_contact_details(user_id: int, email: str, phone: str | None) -> None:
    with Session() as db:
        user = db.get(User, user_id)
        user.email = email
        user.phone = phone
        db.commit()


def set_marketing_preference(user_id: int, opted_in: bool) -> None:
    """Patients choose on their profile page whether they want the clinic newsletter."""
    with Session() as db:
        user = db.get(User, user_id)
        user.marketing_opt_in = opted_in
        db.commit()
