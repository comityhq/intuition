import hmac, hashlib, os


def customer_id_from_cookie(value: str | None) -> int | None:
    if not value or "." not in value:
        return None
    cid, sig = value.split(".", 1)
    expected = hmac.new(os.environ["SESSION_SECRET"].encode(), cid.encode(), hashlib.sha256).hexdigest()
    return int(cid) if hmac.compare_digest(sig, expected) else None
