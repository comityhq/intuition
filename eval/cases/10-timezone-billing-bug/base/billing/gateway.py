import os, requests


def charge(customer_id: str, amount_cents: int, idempotency_key: str) -> str:
    r = requests.post(
        "https://api.cardgateway.example/v1/charges",
        headers={"Authorization": f"Bearer {os.environ['GATEWAY_KEY']}", "Idempotency-Key": idempotency_key},
        json={"customer": customer_id, "amount": amount_cents, "currency": "usd"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["id"]
