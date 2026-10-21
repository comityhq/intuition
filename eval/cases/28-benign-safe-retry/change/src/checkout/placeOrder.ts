import { createCharge, isRetryableGatewayError } from "../payments/gateway.js";
import { saveOrder, type Order } from "../orders/repo.js";
import { withRetry } from "../lib/retry.js";

export async function placeOrder(order: Order): Promise<Order> {
  saveOrder({ ...order, status: "pending" });
  try {
    // Same idempotency key on every attempt: the gateway returns the original charge instead of charging again.
    const charge = await withRetry(
      () =>
        createCharge({
          amountCents: order.totalCents,
          currency: "usd",
          customerId: order.customerId,
          description: `BrewBox order ${order.id}`,
          idempotencyKey: `order-${order.id}`,
        }),
      isRetryableGatewayError,
    );
    return saveOrder({ ...order, status: charge.status === "succeeded" ? "paid" : "failed", chargeId: charge.id });
  } catch (err) {
    saveOrder({ ...order, status: "failed" });
    throw err;
  }
}
