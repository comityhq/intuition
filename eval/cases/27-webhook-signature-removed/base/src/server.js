import express from "express";
import { paymentsWebhook } from "./webhooks/payments.js";

const app = express();
app.use("/webhooks/payments", paymentsWebhook);
app.listen(process.env.PORT ?? 3000);
