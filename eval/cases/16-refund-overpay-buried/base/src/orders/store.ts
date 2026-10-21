export interface Order { id: string; chargeId: string; paidCents: number; refundedCents: number; memberEmail: string }
const orders = new Map<string, Order>();
export const getOrder = (id: string) => orders.get(id);
export const saveOrder = (o: Order) => void orders.set(o.id, o);
