from invoices.render import render_text

INV = {"number": "INV-0042", "currency": "usd", "items": [
    {"description": "Monthly bookkeeping", "unit_cents": 19900, "qty": 1},
    {"description": "Extra receipts", "unit_cents": 25, "qty": 1234},
]}


def test_render_text():
    assert render_text(INV) == "Invoice INV-0042\nMonthly bookkeeping x1: $199.00\nExtra receipts x1234: $308.50\nTotal: $507.50"


def test_unknown_currency_uses_code():
    out = render_text({**INV, "currency": "chf"})
    assert "CHF 199.00" in out
