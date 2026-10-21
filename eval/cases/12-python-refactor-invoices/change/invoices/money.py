from decimal import Decimal, ROUND_HALF_UP

SYMBOLS = {"usd": "$", "eur": "€", "gbp": "£"}


def format_cents(cents: int, currency: str) -> str:
    """Format an amount in cents as e.g. '$1,234.50' (unknown currencies use their code: 'CHF 12.00')."""
    amount = (Decimal(cents) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    symbol = SYMBOLS.get(currency, currency.upper() + " ")
    return f"{symbol}{amount:,.2f}"
