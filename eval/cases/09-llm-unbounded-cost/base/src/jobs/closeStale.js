import { pool } from "../db.js";

export async function closeStaleTickets() {
  await pool.query("UPDATE tickets SET status = 'closed' WHERE status = 'pending' AND updated_at < now() - interval '30 days'");
}
