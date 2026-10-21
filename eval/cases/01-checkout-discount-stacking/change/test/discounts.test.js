import test from "node:test";
import assert from "node:assert/strict";
import { applyPromo } from "../src/cart/discounts.js";
import { cartTotal } from "../src/cart/total.js";

const cart = () => ({ id: "c1", items: [{ sku: "mug", name: "Mug", priceCents: 2000, qty: 2 }], promos: [] });

test("applies a single promo", () => {
  const c = applyPromo(cart(), "welcome10");
  assert.equal(cartTotal(c), 3600);
});

test("combines referral and seasonal promo", () => {
  const c = applyPromo(applyPromo(cart(), "FRIEND15"), "SPRING25");
  assert.equal(cartTotal(c), 2400);
});

test("rejects unknown codes", () => {
  assert.throws(() => applyPromo(cart(), "NOPE"));
});
