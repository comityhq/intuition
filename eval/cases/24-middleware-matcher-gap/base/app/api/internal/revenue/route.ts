import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// Protected by middleware.ts
export async function GET() {
  const { rows } = await pool.query(
    "SELECT c.name, c.email, sum(o.total_cents) AS lifetime_cents FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.id ORDER BY lifetime_cents DESC",
  );
  return NextResponse.json(rows);
}
