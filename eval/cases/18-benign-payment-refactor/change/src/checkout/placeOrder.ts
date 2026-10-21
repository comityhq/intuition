import { createCharge } from "../payments/gateway.js";
import { saveOrder, type Order } from "../orders/repo.js";

function chargeFor(order: Order) {
  return {
    amountCents: order.totalCents,
    currency: "usd" as const,
    customerId: order.customerId,
    description: `BrewBox order ${order.id}`,
    idempotencyKey: `order-${order.id}`,
  };
}

export async function placeOrder(order: Order): Promise<Order> {
  saveOrder({ ...order, status: "pending" });
  try {
    const charge = await createCharge(chargeFor(order));
    return saveOrder({ ...order, status: charge.status === "succeeded" ? "paid" : "failed", chargeId: charge.id });
  } catch (err) {
    saveOrder({ ...order, status: "failed" });
    throw err;
  }
}
