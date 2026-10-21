export type AgentId = "claude" | "codex" | "gemini";
export type Verdict = "green" | "yellow" | "red";
export type Level = "low" | "medium" | "high";
export type Category =
  | "security"
  | "money"
  | "data"
  | "privacy"
  | "reliability"
  | "users"
  | "legal"
  | "cost"
  | "other";

export const AGENTS: readonly AgentId[] = ["claude", "codex", "gemini"];
export const VERDICTS: readonly Verdict[] = ["green", "yellow", "red"];
export const LEVELS: readonly Level[] = ["low", "medium", "high"];
export const CATEGORIES: readonly Category[] = [
  "security",
  "money",
  "data",
  "privacy",
  "reliability",
  "users",
  "legal",
  "cost",
  "other",
];

export interface Risk {
  level: Level;
  category: Category;
  title: string;
  explanation: string;
  where: string[];
  confidence: Level;
}

/** What the reviewer model writes. Everything else in a Report is filled in by us. */
export interface ReviewContent {
  verdict: Verdict;
  headline: string;
  what_changed: string[];
  risks: Risk[];
  questions_for_developer: string[];
  good_news: string[];
}

export interface Report extends ReviewContent {
  version: 1;
  id: string;
  created_at: string;
  repo: string;
  base: string;
  head: string | null;
  reviewer: {
    agent: AgentId;
    model: string | null;
    forked_from_session: string | null;
  };
  files_reviewed: string[];
  truncated: boolean;
}

/** JSON Schema for ReviewContent. Strict (all required, no extras) so it works with OpenAI structured outputs too. */
export const REVIEW_CONTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "headline", "what_changed", "risks", "questions_for_developer", "good_news"],
  properties: {
    verdict: { type: "string", enum: [...VERDICTS] },
    headline: { type: "string" },
    what_changed: { type: "array", items: { type: "string" } },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["level", "category", "title", "explanation", "where", "confidence"],
        properties: {
          level: { type: "string", enum: [...LEVELS] },
          category: { type: "string", enum: [...CATEGORIES] },
          title: { type: "string" },
          explanation: { type: "string" },
          where: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: [...LEVELS] },
        },
      },
    },
    questions_for_developer: { type: "array", items: { type: "string" } },
    good_news: { type: "array", items: { type: "string" } },
  },
} as const;
