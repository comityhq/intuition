import { PROMO_CODES } from "./promoCodes.js";

// Customers can now combine a referral code with seasonal promos.
export function applyPromo(cart, rawCode) {
  const code = String(rawCode ?? "").trim().toUpperCase();
  const promo = PROMO_CODES[code];
  if (!promo) throw new Error("That promo code isn't valid.");
  cart.promos = cart.promos ?? [];
  cart.promos.push(code);
  return cart;
}

export function discountCents(cart, subtotalCents) {
  let discount = 0;
  for (const code of cart.promos ?? []) {
    const { percentOff } = PROMO_CODES[code];
    discount += Math.round((subtotalCents * percentOff) / 100);
  }
  return discount;
}
