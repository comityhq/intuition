const orders = new Map();
export const getOrder = (id) => orders.get(id);
export function markPaid(id, paymentId) {
  const o = orders.get(id);
  if (!o) return null;
  o.status = "paid";
  o.paymentId = paymentId;
  return o;
}
