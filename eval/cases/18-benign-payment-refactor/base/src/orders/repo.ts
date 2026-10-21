export interface Order {
  id: string;
  customerId: string;
  totalCents: number;
  status: "pending" | "paid" | "failed";
  chargeId?: string;
}

const orders = new Map<string, Order>();

export function saveOrder(o: Order): Order {
  orders.set(o.id, o);
  return o;
}

export function getOrder(id: string): Order | undefined {
  return orders.get(id);
}
