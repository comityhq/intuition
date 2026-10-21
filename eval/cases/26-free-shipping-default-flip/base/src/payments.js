// Thin wrapper around our payment provider.
export async function chargeCustomer(customerId, amountCents) {
  if (amountCents <= 0) return { id: "free_" + Date.now(), amountCents: 0 };
  const res = await fetch("https://payments.example.com/v1/charges", {
    method: "POST",
    headers: { authorization: "Bearer " + process.env.PAYMENTS_KEY, "content-type": "application/json" },
    body: JSON.stringify({ customer: customerId, amount: amountCents, currency: "usd" }),
  });
  return res.json();
}
