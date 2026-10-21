import { refundCharge } from "../payments/gateway.js";
import { getOrder, saveOrder } from "../orders/store.js";

export async function refundOrder(orderId: string, agentId: string): Promise<void> {
  const order = getOrder(orderId);
  if (!order) throw new Error("Order not found");
  const remaining = order.paidCents - order.refundedCents;
  if (remaining <= 0) throw new Error("Order already fully refunded");
  await refundCharge(order.chargeId, remaining, `refund-${order.id}-full`);
  saveOrder({ ...order, refundedCents: order.paidCents });
  console.log(`refund by ${agentId} for ${order.id}: ${remaining}`);
}
