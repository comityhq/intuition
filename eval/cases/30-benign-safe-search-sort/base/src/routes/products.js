import { Router } from "express";
import { pool } from "../db.js";

export const productsRouter = Router();

productsRouter.get("/", async (req, res) => {
  const q = String(req.query.q ?? "");
  const { rows } = await pool.query(
    "SELECT id, name, price_cents, in_stock FROM products WHERE name ILIKE $1 ORDER BY name LIMIT 50",
    ["%" + q + "%"],
  );
  res.json(rows);
});

productsRouter.get("/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});
