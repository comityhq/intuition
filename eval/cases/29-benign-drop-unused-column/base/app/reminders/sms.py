import os
from datetime import datetime, timedelta, timezone
from twilio.rest import Client
from ..db import Session
from ..models import Appointment

twilio = Client(os.environ["TWILIO_SID"], os.environ["TWILIO_TOKEN"])


def send_due_reminders() -> int:
    """Text every patient whose appointment starts in the next 24 hours."""
    now = datetime.now(timezone.utc)
    sent = 0
    with Session() as db:
        due = (
            db.query(Appointment)
            .filter(Appointment.starts_at <= now + timedelta(hours=24), Appointment.starts_at > now, Appointment.reminder_sent.is_(False))
            .all()
        )
        for appt in due:
            user = appt.patient
            if not user.sms_opt_in or not user.phone:
                continue
            twilio.messages.create(
                to=user.phone,
                from_=os.environ["TWILIO_FROM"],
                body=f"Hi {user.full_name.split()[0]}, reminder: your appointment is {appt.starts_at:%a %d %b at %H:%M}.",
            )
            appt.reminder_sent = True
            sent += 1
        db.commit()
    return sent
