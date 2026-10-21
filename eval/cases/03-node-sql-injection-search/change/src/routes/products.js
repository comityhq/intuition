import { Router } from "express";
import { pool } from "../db.js";

export const productsRouter = Router();

// Search now supports category filter and sorting (requested by the design team).
productsRouter.get("/", async (req, res) => {
  const q = String(req.query.q ?? "");
  const category = req.query.category;
  const sort = req.query.sort ?? "name";
  let sql = `SELECT id, name, category, price_cents, in_stock FROM products WHERE name ILIKE '%${q}%'`;
  if (category) sql += ` AND category = '${category}'`;
  sql += ` ORDER BY ${sort} LIMIT 50`;
  try {
    const { rows } = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql });
  }
});

productsRouter.get("/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});
