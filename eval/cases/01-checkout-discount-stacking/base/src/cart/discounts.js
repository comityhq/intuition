import { PROMO_CODES } from "./promoCodes.js";

export function applyPromo(cart, rawCode) {
  const code = String(rawCode ?? "").trim().toUpperCase();
  const promo = PROMO_CODES[code];
  if (!promo) throw new Error("That promo code isn't valid.");
  if (cart.promo) throw new Error("Only one promo code can be used per order.");
  cart.promo = code;
  return cart;
}

export function discountCents(cart, subtotalCents) {
  if (!cart.promo) return 0;
  const { percentOff } = PROMO_CODES[cart.promo];
  return Math.round((subtotalCents * percentOff) / 100);
}
