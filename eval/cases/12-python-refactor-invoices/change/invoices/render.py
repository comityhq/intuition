from typing import Any

from .money import format_cents

Invoice = dict[str, Any]
LineItem = dict[str, Any]


def render_line(item: LineItem, currency: str) -> str:
    return f"{item['description']} x{item['qty']}: {format_cents(item['unit_cents'] * item['qty'], currency)}"


def invoice_total_cents(invoice: Invoice) -> int:
    return sum(i["unit_cents"] * i["qty"] for i in invoice["items"])


def render_total(invoice: Invoice) -> str:
    return f"Total: {format_cents(invoice_total_cents(invoice), invoice['currency'])}"


def render_text(invoice: Invoice) -> str:
    lines = [f"Invoice {invoice['number']}"]
    lines += [render_line(item, invoice["currency"]) for item in invoice["items"]]
    lines.append(render_total(invoice))
    return "\n".join(lines)
