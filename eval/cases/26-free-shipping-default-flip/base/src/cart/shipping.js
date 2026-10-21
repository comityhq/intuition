// Free shipping promo is opt-in: set FREE_SHIPPING=true during promo weekends.
const FREE_SHIPPING = process.env.FREE_SHIPPING === "true";
const FLAT_RATE_CENTS = 599;

export function shippingCents(subtotalCents) {
  if (FREE_SHIPPING) return 0;
  return subtotalCents >= 7500 ? 0 : FLAT_RATE_CENTS;
}
