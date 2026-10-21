import OpenAI from "openai";
import { pool } from "../db.js";

const openai = new OpenAI();

async function summarize(text) {
  while (true) {
    try {
      const r = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Summarize this support conversation in 3 sentences." },
          { role: "user", content: text },
        ],
      });
      const summary = r.choices[0].message.content;
      // Keep summaries short for the inbox preview.
      if (summary.length > 280) return summarize(summary);
      return summary;
    } catch (err) {
      console.warn("openai error, retrying", err.message);
    }
  }
}

export async function summarizeAllTickets() {
  const { rows } = await pool.query("SELECT id, (SELECT string_agg(body, E'\n') FROM messages m WHERE m.ticket_id = t.id) AS thread FROM tickets t");
  await Promise.all(
    rows.map(async (t) => {
      const summary = await summarize(t.thread ?? "");
      await pool.query("UPDATE tickets SET summary = $1 WHERE id = $2", [summary, t.id]);
    }),
  );
}
