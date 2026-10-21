import { GatewayError } from "./errors.js";

export interface ChargeRequest {
  amountCents: number;
  currency: "usd" | "eur";
  customerId: string;
  description: string;
  idempotencyKey?: string;
}

export interface Charge {
  id: string;
  status: "succeeded" | "failed";
  amountCents: number;
}

const API = "https://api.cardgateway.example/v1";

function authHeaders(idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${process.env.GATEWAY_SECRET_KEY}`,
    "content-type": "application/json",
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return headers;
}

export async function createCharge(req: ChargeRequest): Promise<Charge> {
  const res = await fetch(`${API}/charges`, {
    method: "POST",
    headers: authHeaders(req.idempotencyKey),
    body: JSON.stringify({ amount: req.amountCents, currency: req.currency, customer: req.customerId, description: req.description }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new GatewayError(res.status);
  return (await res.json()) as Charge;
}
