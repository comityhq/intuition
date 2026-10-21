import express from "express";
import { pool } from "./db.js";
import { redeemCoupon } from "./coupons/redeem.js";

const app = express();
app.use(express.json());

app.post("/orders/:id/coupon", async (req, res) => {
  try {
    const off = await redeemCoupon(req.params.id, String(req.body.code ?? "").trim().toUpperCase());
    res.json({ ok: true, amount_off_cents: off });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/orders/:id/pay", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).end();
  res.json({ payable_cents: rows[0].total_cents - rows[0].discount_cents });
});

app.listen(process.env.PORT ?? 3000);
