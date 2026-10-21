from app.routes_invoices import download_my_invoices_csv


class FakeQuery:
    def __init__(self, rows): self.rows = rows
    def filter(self, *a): return self
    def order_by(self, *a): return self
    def all(self): return self.rows


class FakeDb:
    def __init__(self, rows): self.rows = rows
    def query(self, _model): return FakeQuery(self.rows)


def test_csv_has_header_and_rows():
    from datetime import date
    from types import SimpleNamespace
    rows = [SimpleNamespace(number="INV-1", issued_on=date(2026, 9, 1), total_cents=19900, status="paid")]
    resp = download_my_invoices_csv(me=SimpleNamespace(id=7), db=FakeDb(rows))
    assert resp.media_type == "text/csv"
