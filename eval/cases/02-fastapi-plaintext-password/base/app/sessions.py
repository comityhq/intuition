import os, hmac, hashlib, time


def create_session_token(user_id: int) -> str:
    ts = str(int(time.time()))
    msg = f"{user_id}.{ts}".encode()
    sig = hmac.new(os.environ["SESSION_SECRET"].encode(), msg, hashlib.sha256).hexdigest()
    return f"{user_id}.{ts}.{sig}"
