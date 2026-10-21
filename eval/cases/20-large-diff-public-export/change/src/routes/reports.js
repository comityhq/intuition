import { Router } from "express";
import { pool } from "../db.js";
export const reportsRouter = Router();

// Monthly spend chart + CSV export for the owner's accountant.
reportsRouter.get("/monthly", async (_req, res) => {
  const { rows } = await pool.query("SELECT date_trunc('month', created_at) AS month, sum(total_cents) AS cents FROM orders GROUP BY 1 ORDER BY 1");
  res.json(rows);
});

reportsRouter.get("/customers.csv", async (_req, res) => {
  const { rows } = await pool.query("SELECT full_name, email, phone, birthday, lifetime_spend_cents FROM customers ORDER BY lifetime_spend_cents DESC");
  res.type("text/csv").send(["name,email,phone,birthday,lifetime_spend", ...rows.map((r) => [r.full_name, r.email, r.phone, r.birthday, r.lifetime_spend_cents / 100].join(","))].join("\n"));
});
