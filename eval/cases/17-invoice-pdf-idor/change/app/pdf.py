def invoice_pdf_bytes(number: str, issued_on: str, total: str, customer_email: str) -> bytes:
    """Very small text-based PDF so customers can forward invoices to their accountant."""
    text = f"Invoice {number}\nIssued {issued_on}\nBilled to {customer_email}\nTotal {total}"
    body = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET"
    return (
        "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        f"3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n4 0 obj<</Length {len(body)}>>stream\n{body}\nendstream endobj\n%%EOF"
    ).encode()
