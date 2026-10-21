import { refundCharge } from "../payments/gateway.js";
import { getOrder, saveOrder } from "../orders/store.js";
import { money } from "../format.js";

/**
 * Refund an order. Support agents can now refund part of an order (e.g. one missed class)
 * by passing amountCents; omit it to refund whatever is left.
 */
export async function refundOrder(orderId: string, agentId: string, amountCents?: number): Promise<void> {
  const order = getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const amount = amountCents ?? order.paidCents - order.refundedCents;
  await refundCharge(order.chargeId, amount, `refund-${order.id}-${Date.now()}`);
  saveOrder({ ...order, refundedCents: order.refundedCents + amount });
  console.log(`refund by ${agentId} for ${order.id}: ${money(amount)}`);
}
