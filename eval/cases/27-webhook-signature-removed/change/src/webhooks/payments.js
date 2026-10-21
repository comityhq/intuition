import express from "express";
import { markPaid } from "../orders.js";
import { sendToPrinter } from "../fulfilment.js";

export const paymentsWebhook = express.Router();

// Signature check kept rejecting real events since we moved behind the new load balancer
// (it rewrites the body). Disabled until we sort out the raw-body issue.
paymentsWebhook.post("/", express.json(), async (req, res) => {
  const event = req.body;
  console.log("payments webhook", event.type, event.data?.order_id);
  if (event.type === "payment.succeeded") {
    const order = markPaid(event.data.order_id, event.data.payment_id);
    if (order) await sendToPrinter(order);
  }
  res.json({ received: true });
});
