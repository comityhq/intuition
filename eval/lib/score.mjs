// Scoring: schema validity, verdict accuracy, seeded-risk detection, false positives, plain-English readability.

const VERDICTS = ["green", "yellow", "red"];
const LEVELS = ["low", "medium", "high"];
const CATEGORIES = ["security", "money", "data", "privacy", "reliability", "users", "legal", "cost", "other"];

export function validateReport(r) {
  const errs = [];
  const isStr = (v) => typeof v === "string";
  const isStrArr = (v) => Array.isArray(v) && v.every(isStr);
  if (!r || typeof r !== "object") return ["report is not an object"];
  if (r.version !== 1) errs.push("version != 1");
  for (const k of ["id", "created_at", "repo", "base", "headline"]) if (!isStr(r[k])) errs.push(`${k} not a string`);
  if (!(r.head === null || isStr(r.head))) errs.push("head not string|null");
  if (!r.reviewer || !["claude", "codex", "gemini"].includes(r.reviewer.agent)) errs.push("reviewer.agent invalid");
  if (r.reviewer && !(r.reviewer.model === null || isStr(r.reviewer.model))) errs.push("reviewer.model invalid");
  if (r.reviewer && !(r.reviewer.forked_from_session === null || isStr(r.reviewer.forked_from_session))) errs.push("reviewer.forked_from_session invalid");
  if (!VERDICTS.includes(r.verdict)) errs.push(`verdict invalid: ${r.verdict}`);
  for (const k of ["what_changed", "questions_for_developer", "good_news", "files_reviewed"]) if (!isStrArr(r[k])) errs.push(`${k} not string[]`);
  if (typeof r.truncated !== "boolean") errs.push("truncated not boolean");
  if (!Array.isArray(r.risks)) errs.push("risks not array");
  else
    r.risks.forEach((x, i) => {
      if (!LEVELS.includes(x?.level)) errs.push(`risks[${i}].level invalid`);
      if (!CATEGORIES.includes(x?.category)) errs.push(`risks[${i}].category invalid: ${x?.category}`);
      if (!LEVELS.includes(x?.confidence)) errs.push(`risks[${i}].confidence invalid`);
      if (!isStr(x?.title) || !isStr(x?.explanation)) errs.push(`risks[${i}] title/explanation missing`);
      if (!isStrArr(x?.where)) errs.push(`risks[${i}].where not string[]`);
    });
  if (isStr(r.created_at) && Number.isNaN(Date.parse(r.created_at))) errs.push("created_at not ISO");
  return errs;
}

const normPath = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "").replace(/:\d+(-\d+)?$/, "").toLowerCase();
function fileMatch(where, files) {
  const w = (where ?? []).map(normPath);
  const f = files.map(normPath);
  return w.some((a) => f.some((b) => a === b || a.endsWith("/" + b) || b.endsWith("/" + a)));
}
const kwMatch = (risk, keywords) => {
  const text = `${risk.title} ${risk.explanation}`.toLowerCase();
  return keywords.some((k) => text.includes(k.toLowerCase()));
};

/** Score one report against a case's ground truth. */
export function scoreCase(c, report) {
  const risks = report.risks ?? [];
  const serious = risks.filter((r) => r.level !== "low");
  const used = new Set();
  const matches = (m, r) => {
    const cat = m.categories.includes(r.category);
    const file = fileMatch(r.where, m.files);
    const kw = kwMatch(r, m.keywords ?? []);
    return { ok: kw && (cat || file), cat, file, kw };
  };
  const findings = (c.must_find ?? []).map((m) => {
    let best = null;
    risks.forEach((r, i) => {
      const { ok, cat, file, kw } = matches(m, r);
      if (!ok) return;
      used.add(i); // restating the seeded risk (e.g. its privacy consequence) is not a false positive
      const rank = (r.level === "high" ? 3 : r.level === "medium" ? 2 : 1) * 10 + (cat ? 2 : 0) + (file ? 1 : 0);
      if (!best || rank > best.rank) best = { i, rank, risk: r, cat, file, kw };
    });
    if (best) used.add(best.i);
    // Not a pass, but worth reporting: the reviewer only raised it as a question for the developer.
    const inQuestions = !best && (report.questions_for_developer ?? []).some((q) => kwMatch({ title: q, explanation: "" }, m.keywords ?? []));
    return {
      label: m.label,
      found: !!best && best.risk.level !== "low",
      weak: !!best && best.risk.level === "low",
      in_questions_only: inQuestions,
      level: best?.risk.level ?? null,
      category: best?.risk.category ?? null,
      category_ok: best?.cat ?? false,
      file_ok: best?.file ?? false,
      title: best?.risk.title ?? null,
    };
  });
  // Real secondary problems in the seeded change (listed in case.json "also_ok") are not false positives either.
  const secondary = (r) => (c.also_ok ?? []).some((a) => kwMatch(r, a.keywords) && (!a.categories || a.categories.includes(r.category)));
  const falsePositives = serious.filter((r) => !used.has(risks.indexOf(r)) && !secondary(r));
  const highs = risks.filter((r) => r.level === "high");
  const verdictOk = c.expected_verdict.includes(report.verdict);
  const allFound = findings.every((f) => f.found);
  const fpOk = falsePositives.length <= c.max_false_positives;
  let pass;
  if (c.kind === "benign") pass = report.verdict === "green" && highs.length === 0 && fpOk;
  else pass = verdictOk && allFound && fpOk;
  return {
    verdict: report.verdict,
    verdict_ok: verdictOk,
    findings,
    found: findings.filter((f) => f.found).length,
    expected: findings.length,
    serious_risks: serious.length,
    false_positives: falsePositives.map((r) => ({ level: r.level, category: r.category, title: r.title, where: r.where })),
    precision: serious.length ? (serious.length - falsePositives.length) / serious.length : 1,
    high_risks: highs.length,
    pass,
  };
}

// ---------- readability ----------
// Technical terms a non-technical founder should not have to know. A term is OK if explained once
// (e.g. "idempotency key (a unique order stamp)" or "a unique order stamp (idempotency key)").
const JARGON = [
  "idempoten\\w*", "endpoints?", "middleware", "APIs?", "SQL", "ORM", "schemas?", "migrations?", "hash(?:es|ed|ing)?", "bcrypt", "salt(?:ed|ing)?",
  "JWTs?", "CSRF", "XSS", "CORS", "regex(?:es)?", "null", "undefined", "async", "await", "race conditions?", "mutex", "deadlocks?", "stack traces?",
  "env(?:ironment)? var(?:iable)?s?", "cron(?: job)?s?", "webhooks?", "payloads?", "seriali[sz]\\w*", "refactor\\w*", "repos?", "diffs?", "pull requests?",
  "runtime", "exceptions?", "parameteri[sz]ed", "sanitiz\\w*", "PII", "RBAC", "OAuth", "localStorage", "DOM", "SSR", "hydration", "CI", "linters?",
  "npm", "HTTP", "status codes?", "backoff", "recursi(?:on|ve(?:ly)?)", "UTC", "datetimes?", "SDKs?", "CLI", "foreign keys?", "rollbacks?", "booleans?",
  "integers?", "arrays?", "Promise\\.all", "concurren\\w*", "throttl\\w*", "mock(?:s|ed)?", "stub(?:s|bed)?", "TypeScript", "middlewares?", "ILIKE",
  "query strings?", "(?:HTTP|request|response) headers?", "dependenc(?:y|ies)", "plaintext", "upsert", "SMTP", "JSON",
];
const JARGON_RE = new RegExp(`\\b(${JARGON.join("|")})\\b`, "g");
const CODE_RE = /`[^`]+`|\b[a-z]+_[a-z0-9_]+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b|\b\w+\(\)|\b[\w-]+\.(?:py|js|ts|tsx|jsx|sql|json|toml|ya?ml|env)\b/g;

function explained(text, idx, term) {
  const after = text.slice(idx + term.length, idx + term.length + 4);
  if (/^\s*[(—–]/.test(after) || /^\s*-\s/.test(after)) return true;
  if (/^,\s*(which|meaning|i\.e\.|that is|a |an |the )/i.test(text.slice(idx + term.length, idx + term.length + 14))) return true;
  const before = text.slice(Math.max(0, idx - 80), idx);
  const open = before.lastIndexOf("(");
  if (open !== -1 && before.lastIndexOf(")") < open) return true; // term itself sits inside a bracketed aside
  if (/(called|known as|so-called|a\.k\.a\.?)\s+["“]?$/i.test(before)) return true;
  return false;
}

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function fkGrade(text) {
  const sentences = text.split(/[.!?]+(?:\s|$)|\n/).filter((s) => s.trim().split(/\s+/).length >= 3);
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  if (!sentences.length || !words.length) return 0;
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  return 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
}

export function scoreReadability(report) {
  const prose = [
    report.headline,
    ...(report.what_changed ?? []),
    ...(report.risks ?? []).flatMap((r) => [r.title, r.explanation]),
    ...(report.questions_for_developer ?? []),
    ...(report.good_news ?? []),
  ].filter(Boolean);
  const all = prose.join("\n");
  const seen = new Map();
  for (const m of all.matchAll(JARGON_RE)) {
    const key = m[1].toLowerCase().replace(/s$/, "");
    if (seen.has(key)) continue; // only the first use needs an explanation
    seen.set(key, { term: m[1], explained: explained(all, m.index, m[1]) });
  }
  const unexplained = [...seen.values()].filter((v) => !v.explained).map((v) => v.term);
  const upfront = [report.headline, ...(report.what_changed ?? []), ...(report.risks ?? []).map((r) => r.title)].filter(Boolean).join("\n");
  const codeTokens = [...new Set([...upfront.matchAll(CODE_RE)].map((m) => m[0]))];
  const headlineWords = (report.headline ?? "").split(/\s+/).filter(Boolean).length;
  const grade = fkGrade(all);
  // A founder reads the headline first: it must be a real sentence (5-30 words).
  const headlineOk = headlineWords >= 5 && headlineWords <= 30;
  let score = 100 - 8 * unexplained.length - 5 * codeTokens.length - Math.max(0, grade - 10) * 4 - (headlineOk ? 0 : 30);
  score = Math.max(0, Math.round(score));
  return { score, unexplained_jargon: unexplained, code_tokens_upfront: codeTokens, fk_grade: Math.round(grade * 10) / 10, headline_words: headlineWords, headline_ok: headlineOk, good: score >= 70 && unexplained.length <= 2 && headlineOk };
}
