import { createCharge } from "../payments/gateway.js";
import { saveOrder, type Order } from "../orders/repo.js";
import { withRetry } from "../lib/retry.js";

export async function placeOrder(order: Order): Promise<Order> {
  saveOrder({ ...order, status: "pending" });
  try {
    // The gateway sometimes times out under load; retry so customers don't see an error.
    const charge = await withRetry(() =>
      createCharge({
        amountCents: order.totalCents,
        currency: "usd",
        customerId: order.customerId,
        description: `BrewBox order ${order.id} (${new Date().toISOString()})`,
      }),
    );
    return saveOrder({ ...order, status: charge.status === "succeeded" ? "paid" : "failed", chargeId: charge.id });
  } catch (err) {
    saveOrder({ ...order, status: "failed" });
    throw err;
  }
}
