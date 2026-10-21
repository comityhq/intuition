import { Router } from "express";
import { pool } from "../db.js";
export const customersRouter = Router();

customersRouter.get("/", async (_req, res) => {
  const { rows } = await pool.query("SELECT id, full_name, loyalty_points FROM customers ORDER BY full_name LIMIT 200");
  res.json(rows);
});
