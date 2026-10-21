import os, smtplib
from email.message import EmailMessage


def send_email(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = "hello@habitly.app"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(os.environ.get("SMTP_HOST", "localhost")) as s:
        s.send_message(msg)
