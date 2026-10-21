import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { calibrateVerdict, extractJsonObject, normalizeReview, ReviewParseError } from "../src/report/normalize.js";
import { FOOTER, renderHtml, renderMarkdown } from "../src/report/render.js";
import { loadReport, newReportId, saveReport } from "../src/report/store.js";
import type { Report, Risk } from "../src/report/types.js";
import { chatPresentation, statusLine } from "../src/present.js";
import { parseClaudeOutput } from "../src/reviewers.js";
import { cleanup, SAMPLE_CONTENT, tempDir } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

function report(overrides: Partial<Report> = {}): Report {
  return {
    version: 1,
    id: "2026-10-21T10-00-00-abc123",
    created_at: "2026-10-21T10:00:00.000Z",
    repo: "/work/tiny-shop",
    base: "abc",
    head: null,
    reviewer: { agent: "claude", model: "claude-opus", forked_from_session: "sess-1" },
    ...SAMPLE_CONTENT,
    files_reviewed: ["src/pricing.js"],
    truncated: false,
    ...overrides,
  };
}

const risk = (level: Risk["level"], confidence: Risk["confidence"] = "high"): Risk => ({
  level,
  category: "money",
  title: "t",
  explanation: "e",
  where: [],
  confidence,
});

describe("normalizeReview", () => {
  it("cleans up a messy model answer", () => {
    const out = normalizeReview({
      verdict: "GREEN",
      headline: "  A small   copy change on the pricing page. ",
      what_changed: ["Button text", "Button text", "", 42],
      risks: [
        { level: "huge", category: "vibes", title: "Typo", explanation: "Minor.", where: ["./src\\a.js:12"], confidence: "sure" },
        { level: "low", title: "", explanation: "dropped: no title" },
      ],
      questions_for_developer: "not a list",
    });
    expect(out.verdict).toBe("green");
    expect(out.headline).toBe("A small copy change on the pricing page.");
    expect(out.what_changed).toEqual(["Button text"]);
    expect(out.risks).toEqual([
      { level: "medium", category: "other", title: "Typo", explanation: "Minor.", where: ["src/a.js"], confidence: "medium" },
    ]);
    expect(out.questions_for_developer).toEqual([]);
    expect(out.good_news).toEqual([]);
  });

  it("sorts risks most serious first", () => {
    const out = normalizeReview({ verdict: "yellow", headline: "h", risks: [risk("low"), risk("high", "low"), risk("medium")] });
    expect(out.risks.map((r) => r.level)).toEqual(["high", "medium", "low"]);
  });

  it("rejects answers without a verdict or headline", () => {
    expect(() => normalizeReview({ headline: "x" })).toThrow(ReviewParseError);
    expect(() => normalizeReview({ verdict: "green" })).toThrow(ReviewParseError);
    expect(() => normalizeReview(["nope"])).toThrow(ReviewParseError);
  });

  it("replaces placeholder headlines with one built from the verdict and top risk", () => {
    expect(normalizeReview({ verdict: "red", headline: "x", risks: [{ ...risk("high"), title: "Orders can be charged twice" }] }).headline).toBe(
      "Don't ship this yet: Orders can be charged twice.",
    );
    expect(normalizeReview({ verdict: "green", headline: "  ", what_changed: ["The sign-up button text changed."] }).headline).toBe(
      "These changes look safe to ship. The sign-up button text changed.",
    );
    expect(normalizeReview({ verdict: "green", headline: "ok" }).headline).toBe("These changes look safe to ship.");
  });
});

describe("calibrateVerdict", () => {
  it("red needs a high risk the reviewer is confident about", () => {
    expect(calibrateVerdict("red", [])).toBe("yellow");
    expect(calibrateVerdict("red", [risk("medium")])).toBe("yellow");
    expect(calibrateVerdict("red", [risk("high", "low")])).toBe("yellow");
    expect(calibrateVerdict("red", [risk("high")])).toBe("red");
  });

  it("green can't hide a serious risk", () => {
    expect(calibrateVerdict("green", [risk("high")])).toBe("yellow");
    expect(calibrateVerdict("green", [risk("low"), risk("medium")])).toBe("green");
  });

  it("yellow needs at least one medium or high risk", () => {
    expect(calibrateVerdict("yellow", [])).toBe("green");
    expect(calibrateVerdict("yellow", [risk("low"), risk("low", "low")])).toBe("green");
    expect(calibrateVerdict("yellow", [risk("medium", "low")])).toBe("yellow");
  });
});

describe("extractJsonObject", () => {
  it("finds JSON in fences or surrounding prose", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('Here you go: {"a":{"b":"}"}} thanks')).toEqual({ a: { b: "}" } });
    expect(() => extractJsonObject("no json here")).toThrow(ReviewParseError);
  });
});

describe("parseClaudeOutput", () => {
  it("prefers structured_output and reports the main model", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "ignored",
      structured_output: SAMPLE_CONTENT,
      modelUsage: { "claude-haiku": { outputTokens: 3 }, "claude-opus": { outputTokens: 900 } },
    });
    const out = parseClaudeOutput(stdout);
    expect(out.model).toBe("claude-opus");
    expect(out.content.verdict).toBe("yellow");
  });

  it("falls back to JSON in the result text and surfaces errors", () => {
    expect(parseClaudeOutput(JSON.stringify({ subtype: "success", result: JSON.stringify(SAMPLE_CONTENT) })).content.headline).toBe(
      SAMPLE_CONTENT.headline,
    );
    expect(() => parseClaudeOutput(JSON.stringify({ subtype: "error_max_turns", is_error: true, result: "out of turns" }))).toThrow(
      /out of turns/,
    );
  });
});

describe("rendering", () => {
  it("HTML is a self-contained dark one-pager with the footer and escaped content", () => {
    const html = renderHtml(
      report({
        headline: "<script>alert(1)</script> & more",
        risks: [{ ...risk("high"), title: 'Uses "eval"', where: ["src/<x>.js"] }],
        verdict: "red",
      }),
    );
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Uses &quot;eval&quot;");
    expect(html).toContain("src/&lt;x&gt;.js");
    expect(html).toContain("Don&#39;t ship yet".replace("&#39;", "'"));
    expect(html).toContain("#8ec5ff");
    expect(html).toContain("Reviewed by Comity Intuition · free &amp; open source");
    expect(html).toContain('href="https://comity.so"');
    expect(html).not.toMatch(/<link|<script|src="http/);
  });

  it("HTML says so when nothing was found", () => {
    expect(renderHtml(report({ verdict: "green", risks: [] }))).toContain("Nothing worth worrying about");
  });

  it("Markdown has every section and the footer", () => {
    const md = renderMarkdown(report({ truncated: true }));
    expect(md).toMatch(/^# Check with a developer first: /);
    for (const s of ["## What changed", "## Things to check", "## Questions to ask a developer", "## Good news", "## About this review"]) {
      expect(md).toContain(s);
    }
    expect(md).toContain("too large to read in full");
    expect(md.trimEnd().endsWith(FOOTER)).toBe(true);
  });

  it("chat presentation tells the agent to relay, not to fix", () => {
    const text = chatPresentation({ report: report(), htmlPath: "/r.html" });
    expect(text).toContain("Do not change code");
    expect(text).toContain("Anyone can use the staff discount");
    expect(text).toContain("1. Can we limit STAFF50 to staff accounts?");
    expect(text.trimEnd().endsWith("/r.html")).toBe(true);
    expect(statusLine({ report: report(), htmlPath: "/r.html" })).toBe(
      `Comity Intuition: YELLOW (Check with a developer first) - ${SAMPLE_CONTENT.headline} | Full report: /r.html`,
    );
  });
});

describe("report store", () => {
  it("saves json/md/html and loads by id, prefix or newest", async () => {
    const repo = tempDir();
    dirs.push(repo);
    const a = report({ id: "2026-10-21T10-00-00-aaaaaa" });
    const b = report({ id: "2026-10-21T11-00-00-bbbbbb", verdict: "green", risks: [] });
    const paths = await saveReport(repo, a);
    await saveReport(repo, b);
    expect(JSON.parse(readFileSync(paths.json, "utf8"))).toEqual(a);
    expect(readFileSync(paths.html, "utf8")).toContain("<!doctype html>");
    expect(readFileSync(paths.md, "utf8")).toContain(FOOTER);
    expect((await loadReport(repo, null))?.id).toBe(b.id);
    expect((await loadReport(repo, "2026-10-21T10"))?.id).toBe(a.id);
    expect(await loadReport(repo, "nope")).toBeNull();
    expect(readFileSync(`${repo}/.intuition/.gitignore`, "utf8")).toContain("*");
  });

  it("ids sort by time", () => {
    expect(newReportId(new Date("2026-01-02T03:04:05Z"))).toMatch(/^2026-01-02T03-04-05-[0-9a-f]{6}$/);
  });
});
