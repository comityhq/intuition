from invoices.money import format_cents


def test_format_cents():
    assert format_cents(123450, "usd") == "$1,234.50"
    assert format_cents(5, "eur") == "€0.05"
    assert format_cents(1200, "chf") == "CHF 12.00"
