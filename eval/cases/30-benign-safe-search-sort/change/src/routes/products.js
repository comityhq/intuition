import { Router } from "express";
import { pool } from "../db.js";

export const productsRouter = Router();

// Only these sort options are accepted; anything else falls back to name.
const SORTS = {
  name: "name ASC",
  price_asc: "price_cents ASC",
  price_desc: "price_cents DESC",
};

productsRouter.get("/", async (req, res) => {
  const q = String(req.query.q ?? "");
  const category = req.query.category ? String(req.query.category) : null;
  const sort = String(req.query.sort ?? "name");
  const orderBy = Object.hasOwn(SORTS, sort) ? SORTS[sort] : SORTS.name;
  const { rows } = await pool.query(
    `SELECT id, name, category, price_cents, in_stock FROM products
     WHERE name ILIKE $1 AND ($2::text IS NULL OR category = $2)
     ORDER BY ${orderBy} LIMIT 50`,
    ["%" + q + "%", category],
  );
  res.json(rows);
});

productsRouter.get("/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});
