import express from "express";
import { verifySignature } from "./verify.js";
import { markPaid } from "../orders.js";
import { sendToPrinter } from "../fulfilment.js";

export const paymentsWebhook = express.Router();

paymentsWebhook.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verifySignature(raw, req.get("payments-signature"), process.env.PAYMENTS_WEBHOOK_SECRET)) {
    return res.status(400).send("bad signature");
  }
  const event = JSON.parse(raw);
  if (event.type === "payment.succeeded") {
    const order = markPaid(event.data.order_id, event.data.payment_id);
    if (order) await sendToPrinter(order);
  }
  res.json({ received: true });
});
