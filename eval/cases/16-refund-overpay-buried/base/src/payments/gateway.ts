export async function refundCharge(chargeId: string, amountCents: number, idempotencyKey: string): Promise<{ id: string }> {
  const res = await fetch("https://api.cardgateway.example/v1/refunds", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.GATEWAY_SECRET_KEY}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ charge: chargeId, amount: amountCents }),
  });
  if (!res.ok) throw new Error(`refund failed: ${res.status}`);
  return (await res.json()) as { id: string };
}
