from decimal import Decimal, ROUND_HALF_UP

SYMBOLS = {"usd": "$", "eur": "€", "gbp": "£"}


def render_line(item):
    amount = (Decimal(item["unit_cents"]) * item["qty"] / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    sym = SYMBOLS.get(item["currency"], item["currency"].upper() + " ")
    return f"{item['description']} x{item['qty']}: {sym}{amount:,.2f}"


def render_total(invoice):
    cents = sum(i["unit_cents"] * i["qty"] for i in invoice["items"])
    amount = (Decimal(cents) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    sym = SYMBOLS.get(invoice["currency"], invoice["currency"].upper() + " ")
    return f"Total: {sym}{amount:,.2f}"


def render_text(invoice):
    lines = [f"Invoice {invoice['number']}"]
    for item in invoice["items"]:
        lines.append(render_line({**item, "currency": invoice["currency"]}))
    lines.append(render_total(invoice))
    return "\n".join(lines)
