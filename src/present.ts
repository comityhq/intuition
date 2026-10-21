import { AGENT_NAME, VERDICT_LABEL } from "./report/render.js";
import type { Report } from "./report/types.js";


export interface PresentedReview {
  report: Report;
  htmlPath: string;
}

/** One line for the user's terminal (hook `systemMessage`). */
export function statusLine(primary: PresentedReview, second?: PresentedReview): string {
  const r = primary.report;
  const extra = second ? ` | Second opinion (${AGENT_NAME[second.report.reviewer.agent]}): ${second.report.verdict.toUpperCase()}` : "";
  return `Comity Intuition: ${r.verdict.toUpperCase()} (${VERDICT_LABEL[r.verdict]}) - ${r.headline}${extra} | Full report: ${primary.htmlPath}`;
}

/** The review as compact plain text, for the coding agent to relay in chat. */
export function reviewDigest(r: Report): string {
  const lines = [`Verdict: ${r.verdict.toUpperCase()} (${VERDICT_LABEL[r.verdict]})`, `Headline: ${r.headline}`];
  if (r.what_changed.length) lines.push("What changed:", ...r.what_changed.map((c) => `- ${c}`));
  if (r.risks.length) {
    lines.push("Things to check:");
    for (const k of r.risks) {
      const where = k.where.length ? ` (where: ${k.where.join(", ")})` : "";
      lines.push(`- [${k.level.toUpperCase()} risk, ${k.category}, ${k.confidence} confidence] ${k.title}: ${k.explanation}${where}`);
    }
  } else {
    lines.push("Things to check: none found.");
  }
  if (r.questions_for_developer.length) {
    lines.push("Questions to ask a developer:", ...r.questions_for_developer.map((q, i) => `${i + 1}. ${q}`));
  }
  if (r.good_news.length) lines.push("Good news:", ...r.good_news.map((g) => `- ${g}`));
  return lines.join("\n");
}

/**
 * Instruction + review handed back to the coding agent after its turn, so it shows the review in chat.
 * Kept short: it lands in the builder's context, so we avoid anything the user won't see.
 */
export function chatPresentation(primary: PresentedReview, second?: PresentedReview): string {
  const r = primary.report;
  const who = r.reviewer.forked_from_session
    ? "a read-only forked copy of this session"
    : `a read-only ${AGENT_NAME[r.reviewer.agent]} reviewer`;
  const parts = [
    `[Comity Intuition] The user's review tool just checked the changes from your last turn (reviewer: ${who}). Show this review to the user now as your whole reply: keep the verdict, headline, every risk and every question, in plain language, lightly formatted (short markdown, no tables). Do not change code, run commands or start fixing anything unless the user asks. If a point is factually wrong, you may add one short sentence saying why, after the review. End with the report link.`,
    "",
    reviewDigest(r),
  ];
  if (second) {
    const s = second.report;
    parts.push(
      "",
      `Second opinion from ${AGENT_NAME[s.reviewer.agent]}: ${s.verdict.toUpperCase()} (${VERDICT_LABEL[s.verdict]}) - ${s.headline}`,
      ...s.risks.map((k) => `- [${k.level.toUpperCase()}] ${k.title}`),
      `Second opinion report: ${second.htmlPath}`,
    );
  }
  parts.push("", `Full report (open in a browser, easy to forward): ${primary.htmlPath}`);
  return parts.join("\n");
}
