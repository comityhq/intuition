import {
  CATEGORIES,
  LEVELS,
  VERDICTS,
  type Category,
  type Level,
  type ReviewContent,
  type Risk,
  type Verdict,
} from "./types.js";

export class ReviewParseError extends Error {}

const MAX_BULLETS = 8;
const MAX_RISKS = 8;
const MAX_TEXT = 1200;

/** Pull the first balanced JSON object out of free text (models sometimes wrap JSON in prose or fences). */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // fall through
    }
  }
  for (let start = trimmed.indexOf("{"); start !== -1; start = trimmed.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new ReviewParseError("The reviewer did not return a JSON review.");
}

function text(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function textList(value: unknown, max = MAX_BULLETS): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const t = text(item);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = typeof value === "string" ? value.toLowerCase().trim() : "";
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function normalizeRisk(value: unknown): Risk | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const title = text(r.title, 160);
  const explanation = text(r.explanation);
  if (!title || !explanation) return null;
  return {
    level: oneOf<Level>(r.level, LEVELS, "medium"),
    category: oneOf<Category>(r.category, CATEGORIES, "other"),
    title,
    explanation,
    // Repo-relative forward-slash paths, without ":12" / ":12-30" line suffixes.
    where: textList(r.where, 12).map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/:\d+(-\d+)?$/, "")),
    confidence: oneOf<Level>(r.confidence, LEVELS, "medium"),
  };
}

const LEVEL_RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };

/**
 * Make the verdict agree with the risks the reviewer actually listed:
 * - "red" needs at least one high-level risk the reviewer is not unsure about; otherwise it is "yellow".
 * - "green" cannot coexist with a high-level, non-low-confidence risk; that becomes "yellow".
 * - "yellow" needs at least one medium- or high-level risk; with only low-level notes it is "green".
 * This keeps verdicts calibrated: no alarms without a concrete reason, no green over a known serious problem.
 */
export function calibrateVerdict(verdict: Verdict, risks: Risk[]): Verdict {
  const serious = risks.some((r) => r.level === "high" && r.confidence !== "low");
  if (verdict === "red" && !serious) return "yellow";
  if (verdict === "green" && serious) return "yellow";
  if (verdict === "yellow" && !risks.some((r) => r.level !== "low")) return "green";
  return verdict;
}

export function normalizeReview(raw: unknown): ReviewContent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ReviewParseError("The reviewer's answer was not a JSON object.");
  }
  const r = raw as Record<string, unknown>;
  if (!("verdict" in r) || !("headline" in r)) {
    throw new ReviewParseError("The reviewer's answer is missing a verdict or headline.");
  }
  const risks = (Array.isArray(r.risks) ? r.risks : [])
    .map(normalizeRisk)
    .filter((x): x is Risk => x !== null)
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || LEVEL_RANK[b.confidence] - LEVEL_RANK[a.confidence])
    .slice(0, MAX_RISKS);
  const verdict = calibrateVerdict(oneOf<Verdict>(r.verdict, VERDICTS, "yellow"), risks);
  const what_changed = textList(r.what_changed);
  return {
    verdict,
    headline: usableHeadline(text(r.headline, 300), verdict, risks, what_changed),
    what_changed,
    risks,
    questions_for_developer: textList(r.questions_for_developer, 6),
    good_news: textList(r.good_news, 5),
  };
}

const FALLBACK_OPENING: Record<Verdict, string> = {
  green: "These changes look safe to ship",
  yellow: "Check this with a developer before shipping",
  red: "Don't ship this yet",
};

/**
 * A headline must be a real sentence (at least 5 words). Weak models sometimes return a placeholder
 * such as "x"; then we build one from the verdict and the most serious risk (or the first change).
 */
export function usableHeadline(headline: string, verdict: Verdict, risks: Risk[], whatChanged: string[]): string {
  if (headline.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length >= 5) return headline;
  const top = verdict !== "green" ? risks[0]?.title : undefined;
  if (top) return `${FALLBACK_OPENING[verdict]}: ${top.replace(/[.!]+$/, "")}.`;
  const first = whatChanged[0];
  return first ? `${FALLBACK_OPENING[verdict]}. ${first}` : `${FALLBACK_OPENING[verdict]}.`;
}
