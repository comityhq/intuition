import express from "express";
import { getCart, addItem } from "./cart/store.js";
import { applyPromo } from "./cart/discounts.js";
import { cartTotal } from "./cart/total.js";
import { chargeCustomer } from "./payments.js";

const app = express();
app.use(express.json());

app.post("/cart/:id/items", (req, res) => {
  const cart = addItem(req.params.id, req.body);
  res.json({ cart, total: cartTotal(cart) });
});

app.post("/cart/:id/promo", (req, res) => {
  try {
    const cart = applyPromo(getCart(req.params.id), req.body.code);
    res.json({ cart, total: cartTotal(cart) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/cart/:id/checkout", async (req, res) => {
  const cart = getCart(req.params.id);
  const total = cartTotal(cart);
  const charge = await chargeCustomer(req.body.customerId, total);
  res.json({ orderId: charge.id, total });
});

app.listen(process.env.PORT ?? 3000);
