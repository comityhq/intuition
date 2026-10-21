// Win-back campaign: nudge people who haven't been active in a while.
import { pool } from "../src/db.js";
import { sendEmail } from "../src/email.js";

const { rows } = await pool.query("SELECT email, first_name FROM users WHERE last_active_at < now() - interval '30 days' OR last_active_at IS NULL");
for (const u of rows) {
  await sendEmail({
    to: u.email,
    subject: "We miss you! 40% off your next course",
    html: `<p>Hi ${u.first_name ?? "there"}, come back and save 40% with code COMEBACK40.</p>`,
  });
}
console.log(`win-back sent to ${rows.length} users`);
await pool.end();
