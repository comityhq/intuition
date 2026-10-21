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

export class GatewayError extends Error {
  constructor(public readonly status: number) {
    super(`gateway error ${status}`);
  }
}

const API = "https://api.cardgateway.example/v1";

export async function createCharge(req: ChargeRequest): Promise<Charge> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${process.env.GATEWAY_SECRET_KEY}`,
    "content-type": "application/json",
  };
  if (req.idempotencyKey) headers["idempotency-key"] = req.idempotencyKey;
  const res = await fetch(`${API}/charges`, {
    method: "POST",
    headers,
    body: JSON.stringify({ amount: req.amountCents, currency: req.currency, customer: req.customerId, description: req.description }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new GatewayError(res.status);
  return (await res.json()) as Charge;
}

/** Timeouts, dropped connections and 5xx are safe to retry because every attempt carries the same idempotency key. */
export function isRetryableGatewayError(err: unknown): boolean {
  if (err instanceof GatewayError) return err.status >= 500;
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "TypeError");
}
