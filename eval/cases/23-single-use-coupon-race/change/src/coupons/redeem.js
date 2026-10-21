import { pool } from "../db.js";

export async function redeemCoupon(orderId, code) {
  const { rows } = await pool.query("SELECT * FROM coupons WHERE code = $1", [code]);
  const coupon = rows[0];
  if (!coupon) throw new Error("Coupon not found");
  if (coupon.used_at) throw new Error("This coupon has already been used");

  await pool.query("UPDATE orders SET discount_cents = discount_cents + $1 WHERE id = $2", [coupon.amount_off_cents, orderId]);
  await pool.query("UPDATE coupons SET used_at = now(), used_by_order = $1 WHERE code = $2", [orderId, code]);
  return coupon.amount_off_cents;
}
