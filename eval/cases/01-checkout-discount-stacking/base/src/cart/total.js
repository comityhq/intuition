import { discountCents } from "./discounts.js";

export function subtotalCents(cart) {
  return cart.items.reduce((sum, i) => sum + i.priceCents * i.qty, 0);
}

export function cartTotal(cart) {
  const subtotal = subtotalCents(cart);
  return subtotal - discountCents(cart, subtotal);
}
