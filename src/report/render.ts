import type { Level, Report, Verdict } from "./types.js";

export const FOOTER = "Reviewed by Comity Intuition · free & open source · comity.so";

export const VERDICT_LABEL: Record<Verdict, string> = {
  green: "Safe to ship",
  yellow: "Check with a developer first",
  red: "Don't ship yet",
};

const LEVEL_LABEL: Record<Level, string> = { low: "Low", medium: "Medium", high: "High" };

export const AGENT_NAME = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI" } as const;

export function reviewerLine(report: Report): string {
  const who = AGENT_NAME[report.reviewer.agent];
  const model = report.reviewer.model ? ` (${report.reviewer.model})` : "";
  const how = report.reviewer.forked_from_session
    ? "a forked copy of the coding session, so it knew what was asked and why"
    : "a fresh reviewer that saw the changes";
  return `${who}${model}, as ${how}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function repoName(repo: string): string {
  return repo.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || repo;
}

export function renderMarkdown(report: Report): string {
  const out: string[] = [];
  out.push(`# ${VERDICT_LABEL[report.verdict]}: ${report.headline}`, "");
  out.push(
    `**Verdict:** ${report.verdict.toUpperCase()} · **Project:** ${repoName(report.repo)} · **When:** ${formatDate(report.created_at)}`,
    "",
  );
  if (report.what_changed.length) {
    out.push("## What changed", "", ...report.what_changed.map((c) => `- ${c}`), "");
  }
  out.push("## Things to check", "");
  if (report.risks.length === 0) out.push("Nothing worth worrying about was found in these changes.", "");
  for (const r of report.risks) {
    out.push(`### ${LEVEL_LABEL[r.level]} risk · ${r.category}: ${r.title}`, "", r.explanation, "");
    const meta = [`Confidence: ${r.confidence}`];
    if (r.where.length) meta.push(`Where: ${r.where.map((w) => `\`${w}\``).join(", ")}`);
    out.push(`_${meta.join(" · ")}_`, "");
  }
  if (report.questions_for_developer.length) {
    out.push("## Questions to ask a developer", "", ...report.questions_for_developer.map((q, i) => `${i + 1}. ${q}`), "");
  }
  if (report.good_news.length) out.push("## Good news", "", ...report.good_news.map((g) => `- ${g}`), "");
  out.push(
    "## About this review",
    "",
    `- Reviewer: ${reviewerLine(report)}`,
    `- Files reviewed (${report.files_reviewed.length}): ${report.files_reviewed.map((f) => `\`${f}\``).join(", ") || "none"}`,
  );
  if (report.truncated) out.push("- Some changes were too large to read in full; the review is based on a summary of those parts.");
  out.push(`- Report id: \`${report.id}\``, "", "---", "", FOOTER, "");
  return out.join("\n");
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const CSS = `
:root{--bg:#0b0d12;--panel:#12151c;--panel2:#171b24;--line:#232836;--text:#e8ebf2;--muted:#9aa3b5;--accent:#8ec5ff;--green:#3ecf8e;--amber:#f5b942;--red:#ff6b6b}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:820px;margin:0 auto;padding:40px 24px 56px}
.brand{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px;letter-spacing:.06em;text-transform:uppercase}
.brand b{color:var(--accent);font-weight:600}
.dot{width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent)}
.meta{color:var(--muted);font-size:14px;margin-top:6px}
.hero{margin-top:28px;padding:28px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,var(--panel2),var(--panel));position:relative;overflow:hidden}
.hero:before{content:"";position:absolute;inset:0 auto 0 0;width:5px;background:var(--v)}
.pill{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;font-weight:650;font-size:14px;color:var(--v);background:color-mix(in srgb,var(--v) 14%,transparent);border:1px solid color-mix(in srgb,var(--v) 40%,transparent)}
.pill i{width:9px;height:9px;border-radius:50%;background:var(--v)}
h1{font-size:27px;line-height:1.3;margin:16px 0 0;font-weight:700;letter-spacing:-.01em}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:40px 0 14px;font-weight:650}
ul.changes{margin:0;padding:0;list-style:none}
ul.changes li{padding:10px 0 10px 26px;border-bottom:1px solid var(--line);position:relative}
ul.changes li:before{content:"";position:absolute;left:4px;top:20px;width:8px;height:8px;border-radius:2px;background:var(--accent);opacity:.8}
.risk{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:18px 20px;margin:0 0 12px;border-left:4px solid var(--l)}
.risk h3{margin:0 0 6px;font-size:17px;line-height:1.4}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.tag{font-size:12px;padding:2px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.tag.level{color:var(--l);border-color:color-mix(in srgb,var(--l) 45%,transparent);background:color-mix(in srgb,var(--l) 12%,transparent);font-weight:600}
.risk p{margin:0;color:#d5dae5}
.where{margin-top:10px;font-size:13px;color:var(--muted)}
code{font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:12.5px;background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:1px 6px;color:#cfe5ff}
.none{padding:18px 20px;border:1px dashed var(--line);border-radius:14px;color:var(--muted)}
ol.qs{margin:0;padding:0;list-style:none;counter-reset:q}
ol.qs li{counter-increment:q;padding:14px 16px 14px 52px;position:relative;background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:10px}
ol.qs li:before{content:counter(q);position:absolute;left:16px;top:13px;width:24px;height:24px;border-radius:50%;background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent);font-size:13px;font-weight:700;display:grid;place-items:center}
ul.good{margin:0;padding:0;list-style:none}
ul.good li{padding:6px 0 6px 26px;position:relative;color:#d5dae5}
ul.good li:before{content:"✓";position:absolute;left:4px;color:var(--accent);font-weight:700}
details{margin-top:40px;border-top:1px solid var(--line);padding-top:18px;color:var(--muted);font-size:14px}
summary{cursor:pointer;color:var(--text)}
details ul{padding-left:18px}
.note{margin-top:10px;font-size:14px;color:var(--muted)}
footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:13px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
footer a{color:var(--accent);text-decoration:none}
@media (max-width:600px){.wrap{padding:24px 16px 40px}h1{font-size:22px}.hero{padding:22px}}
@media print{html,body{background:#fff;color:#111}.hero,.risk,ol.qs li{background:#fff;border-color:#ddd}.risk p,ul.good li{color:#222}code{background:#f4f6fa;color:#123;border-color:#ddd}}
`;

const VERDICT_COLOR: Record<Verdict, string> = { green: "var(--green)", yellow: "var(--amber)", red: "var(--red)" };
const LEVEL_COLOR: Record<Level, string> = { low: "var(--green)", medium: "var(--amber)", high: "var(--red)" };

export function renderHtml(report: Report): string {
  const risks = report.risks.length
    ? report.risks
        .map(
          (r) => `<article class="risk" style="--l:${LEVEL_COLOR[r.level]}">
  <div class="tags"><span class="tag level">${LEVEL_LABEL[r.level]} risk</span><span class="tag">${esc(r.category)}</span><span class="tag">${esc(r.confidence)} confidence</span></div>
  <h3>${esc(r.title)}</h3>
  <p>${esc(r.explanation)}</p>${r.where.length ? `\n  <div class="where">Where: ${r.where.map((w) => `<code>${esc(w)}</code>`).join(" ")}</div>` : ""}
</article>`,
        )
        .join("\n")
    : `<div class="none">Nothing worth worrying about was found in these changes.</div>`;
  const section = (title: string, body: string) => `<h2>${title}</h2>\n${body}`;
  const parts = [
    `<header><div class="brand"><span class="dot"></span><b>Comity Intuition</b><span>· gut check before you ship</span></div>
<div class="meta">${esc(repoName(report.repo))} · ${esc(formatDate(report.created_at))}</div></header>`,
    `<section class="hero" style="--v:${VERDICT_COLOR[report.verdict]}">
<span class="pill"><i></i>${VERDICT_LABEL[report.verdict]}</span>
<h1>${esc(report.headline)}</h1>
</section>`,
  ];
  if (report.what_changed.length) {
    parts.push(section("What changed", `<ul class="changes">${report.what_changed.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`));
  }
  parts.push(section("Things to check", risks));
  if (report.questions_for_developer.length) {
    parts.push(
      section("Questions to ask a developer", `<ol class="qs">${report.questions_for_developer.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>`),
    );
  }
  if (report.good_news.length) {
    parts.push(section("Good news", `<ul class="good">${report.good_news.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>`));
  }
  parts.push(`<details><summary>About this review · ${report.files_reviewed.length} file${report.files_reviewed.length === 1 ? "" : "s"} reviewed</summary>
<p>Reviewer: ${esc(reviewerLine(report))}.</p>
<ul>${report.files_reviewed.map((f) => `<li><code>${esc(f)}</code></li>`).join("")}</ul>
${report.truncated ? `<p class="note">Some changes were too large to read in full; the review is based on a summary of those parts.</p>` : ""}
<p class="note">Report id <code>${esc(report.id)}</code>. Comity Intuition runs on your computer with your own AI subscription. Nothing was sent to Comity.</p>
</details>`);
  parts.push(`<footer><span>Reviewed by Comity Intuition · free &amp; open source · <a href="https://comity.so">comity.so</a></span><span>${esc(report.verdict.toUpperCase())}</span></footer>`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${esc(VERDICT_LABEL[report.verdict])}: ${esc(report.headline)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="wrap">
${parts.join("\n")}
</main>
</body>
</html>
`;
}
