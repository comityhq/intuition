#!/usr/bin/env node
// Comity Intuition eval runner.
//
//   node eval/run.mjs [--reviewer claude|codex|gemini|same] [--mode manual|hook|both] [--cases 01,07,...]
//                     [--concurrency 3] [--timeout 600] [--cli <path to dist/cli.js>] [--work <dir>] [--label <text>]
//
// manual: builds each case as a git repo (base commit + change) and runs
//         `comity-intuition review --repo <x> --json --reviewer <r>`.
// hook:   for cases with a `hook` block, installs the Claude Code Stop hook (`init --agent claude --scope project`)
//         and runs a real `claude -p` builder session that makes the change; the hook's saved report is scored.
// Results: eval/results/<YYYY-MM-DD>.json (all runs that day, keyed by mode:reviewer) + eval/results/<YYYY-MM-DD>.md.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildCase, DEFAULT_WORK_DIR, EVAL_DIR, loadCases } from "./lib/fixtures.mjs";
import { scoreCase, scoreReadability, validateReport } from "./lib/score.mjs";
import { renderMarkdown, summarize } from "./lib/render.mjs";

const args = parseArgs(process.argv.slice(2));
const reviewer = args.reviewer ?? "claude";
const mode = args.mode ?? "manual";
const concurrency = Number(args.concurrency ?? 3);
const timeoutSec = Number(args.timeout ?? 600);
const cli = path.resolve(args.cli ?? path.join(EVAL_DIR, "..", "dist", "cli.js"));
const workDir = path.resolve(args.work ?? DEFAULT_WORK_DIR);
const cases = loadCases(args.cases ? String(args.cases).split(",") : []);
const date = args.date ?? new Date().toISOString().slice(0, 10);
const resultsDir = path.join(EVAL_DIR, "results");

if (!fs.existsSync(cli)) die(`CLI not found at ${cli} (run npm run build, or pass --cli)`);
fs.mkdirSync(workDir, { recursive: true });
fs.mkdirSync(resultsDir, { recursive: true });

if (args.rescore) {
  // Re-score saved reports with the current ground truth + scorer (no reviews are run).
  const file = path.join(resultsDir, `${date}.json`);
  const all = JSON.parse(fs.readFileSync(file, "utf8"));
  const byId = new Map(loadCases().map((c) => [c.id, c]));
  for (const run of Object.values(all.runs))
    run.results = run.results.map((r) => {
      const c = byId.get(r.id);
      if (!c || !r.report) return r;
      const schema_errors = validateReport(r.report);
      const score = scoreCase(c, r.report);
      const out = { ...r, expected_verdict: c.expected_verdict, schema_errors, ...score, readability: scoreReadability(r.report) };
      out.pass = score.pass && schema_errors.length === 0 && (r.hook_info ? r.hook_ok === true : true);
      return out;
    });
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
  fs.writeFileSync(path.join(resultsDir, `${date}.md`), renderMarkdown(all));
  for (const run of Object.values(all.runs)) printSummary(run);
  process.exit(0);
}

const shimDir = makeShims();
const childEnv = {
  ...process.env,
  PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
  INTUITION_TIMEOUT_SEC: String(timeoutSec),
  NO_COLOR: "1",
  // Reviewer claude (spawned by the hook/CLI) must not load the user's personal settings/plugins/hooks.
  INTUITION_CLAUDE_SETTING_SOURCES: "project,local",
  // The user's Codex config pins a model unavailable under this login; the CLI ignores it on request.
  INTUITION_CODEX_IGNORE_USER_CONFIG: "1",
};

const runs = [];
// --tag distinguishes variants of the same reviewer (e.g. --tag haiku with INTUITION_CLAUDE_MODEL=haiku).
const variant = args.tag ? `${reviewer}@${args.tag}` : reviewer;
if (mode === "manual" || mode === "both") runs.push({ key: `manual:${variant}`, kind: "manual", list: cases });
if (mode === "hook" || mode === "both") runs.push({ key: `hook:claude`, kind: "hook", list: cases.filter((c) => c.hook) });

const RUN_STAMP = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
for (const run of runs) {
  log(`== ${run.key}: ${run.list.length} cases, concurrency ${concurrency}`);
  const started = Date.now();
  const results = await pool(run.list, concurrency, (c) => (run.kind === "manual" ? runManual(c) : runHook(c)));
  const entry = { key: run.key, kind: run.kind, reviewer: run.kind === "hook" ? "claude (forked builder session)" : reviewer, label: args.label ?? null, started_at: new Date(started).toISOString(), duration_sec: Math.round((Date.now() - started) / 1000), cli, results };
  saveRun(entry);
  printSummary(entry);
}

// ---------------------------------------------------------------------------------------------------------------

async function runManual(c) {
  const { repo, reviewArgs } = buildCase(c, path.join(workDir, `manual-${variant.replace("@", "-")}`), "manual");
  const cmdArgs = [cli, "review", "--repo", repo, "--json", ...reviewArgs];
  if (reviewer !== "same") cmdArgs.push("--reviewer", reviewer);
  const t0 = Date.now();
  const p = await exec(process.execPath, cmdArgs, { cwd: repo, env: childEnv, timeoutMs: (timeoutSec + 120) * 1000 });
  const base = { id: c.id, title: c.title, kind: c.kind, stack: c.stack, expected_verdict: c.expected_verdict, duration_sec: Math.round((Date.now() - t0) / 1000), exit_code: p.code, timed_out: p.timedOut };
  let report;
  try {
    report = JSON.parse(p.stdout);
  } catch {
    return { ...base, error: `stdout is not valid JSON (exit ${p.code})`, stdout_tail: tail(p.stdout), stderr_tail: tail(p.stderr), pass: false };
  }
  return finish(c, base, report, p);
}

async function runHook(c) {
  // Fresh folder per run: a builder may leave a process (e.g. a hung test server) holding an old folder open.
  const hookDir = path.join(workDir, `hook-${RUN_STAMP}`);
  const { repo, patch } = buildCase(c, hookDir, "hook");
  const t0 = Date.now();
  const init = await exec(process.execPath, [cli, "init", "--agent", "claude", "--scope", "project"], { cwd: repo, env: childEnv, timeoutMs: 60_000 });
  const base = { id: c.id, title: c.title, kind: c.kind, stack: c.stack, expected_verdict: c.expected_verdict, hook: true };
  if (init.code !== 0) return { ...base, error: `init failed (exit ${init.code})`, stderr_tail: tail(init.stderr + init.stdout), pass: false };
  const fill = (s) => s.replace("{patch}", patch ? patch.replace(/\\/g, "/") : "");
  const builderTurn = async (prompt, resume) => {
    const a = ["-p", fill(prompt), "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--setting-sources", "project,local"];
    if (resume) a.push("--resume", resume);
    if (args["builder-model"]) a.push("--model", args["builder-model"]);
    return exec(process.env.INTUITION_CLAUDE_BIN ?? "claude", a, { cwd: repo, env: childEnv, timeoutMs: 20 * 60_000 });
  };
  const changedCode = async () => {
    const dirty = (await exec("git", ["status", "--porcelain", "--", ".", ":(exclude).claude", ":(exclude).intuition", ":(exclude).gitignore"], { cwd: repo, env: childEnv, timeoutMs: 30_000 })).stdout.trim();
    const commits = Number((await exec("git", ["rev-list", "--count", "HEAD"], { cwd: repo, env: childEnv, timeoutMs: 30_000 })).stdout.trim() || 1);
    return dirty.length > 0 || commits > 1;
  };
  let p = await builderTurn(c.hook.prompt);
  let stdout = p.stdout;
  const firstEvents = parseStream(p.stdout);
  const sessionId = firstEvents.find((e) => e.session_id)?.session_id ?? null;
  let turns = 1;
  // A careful builder may refuse a harmful patch; a real user then insists in the same session.
  if (c.hook.followup && sessionId && !(await changedCode())) {
    p = await builderTurn(c.hook.followup, sessionId);
    stdout += p.stdout;
    turns = 2;
  }
  fs.writeFileSync(path.join(hookDir, `${c.id}.stream.jsonl`), stdout);
  const events = parseStream(stdout);
  const reportsDir = path.join(repo, ".intuition", "reports");
  const reportFiles = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).filter((f) => f.endsWith(".json")).map((f) => path.join(reportsDir, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs) : [];
  const finalText = events.filter((e) => e.type === "result").at(-1)?.result ?? "";
  const hookInfo = {
    builder_session: sessionId,
    builder_turns: turns,
    builder_exit: p.code,
    builder_timed_out: p.timedOut,
    reports_written: reportFiles.length,
    init_output: tail(init.stdout, 600),
    final_message_tail: tail(finalText, 1500),
    post_review_edits: countPostReviewEdits(events),
    gitignored: reportFiles.length > 0 && (await exec("git", ["check-ignore", "-q", reportFiles.at(-1)], { cwd: repo, env: childEnv, timeoutMs: 30_000 })).code === 0,
    html_written: reportFiles.length > 0 && fs.existsSync(reportFiles.at(-1).replace(/\.json$/, ".html")),
  };
  const b = { ...base, duration_sec: Math.round((Date.now() - t0) / 1000), exit_code: p.code, timed_out: p.timedOut, hook_info: hookInfo };
  hookInfo.builder_changed_code = await changedCode();
  if (!hookInfo.builder_changed_code) {
    // Builder declined (e.g. refused a harmful patch). Correct product behaviour is: no review, no noise.
    return { ...b, skipped: "builder made no code changes", pass: reportFiles.length === 0, note: reportFiles.length ? "a report was written although nothing changed" : "no review (correct: nothing changed)" };
  }
  if (!reportFiles.length) return { ...b, error: "no report written by the Stop hook", stderr_tail: tail(p.stderr), pass: false };
  const report = JSON.parse(fs.readFileSync(reportFiles.at(-1), "utf8"));
  hookInfo.forked_from_builder = report.reviewer?.forked_from_session === sessionId;
  hookInfo.relayed_in_chat = relayed(report, finalText);
  const r = finish(c, b, report, p);
  r.hook_ok = hookInfo.reports_written === 1 && hookInfo.forked_from_builder && hookInfo.relayed_in_chat && hookInfo.post_review_edits === 0;
  r.pass = r.pass && r.hook_ok;
  return r;
}

function finish(c, base, report, p) {
  const schema_errors = validateReport(report);
  const score = scoreCase(c, report);
  const readability = scoreReadability(report);
  const rawDir = path.join(resultsDir, "raw", date);
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, `${base.hook ? "hook-claude" : `manual-${variant.replace("@", "-")}`}-${c.id}.json`), JSON.stringify(report, null, 2));
  return { ...base, schema_errors, ...score, readability, report, stderr_tail: schema_errors.length ? tail(p.stderr) : undefined, pass: score.pass && schema_errors.length === 0 };
}

function relayed(report, finalText) {
  const t = finalText.toLowerCase();
  if (!t) return false;
  const words = (report.headline ?? "").toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const hits = words.filter((w) => t.includes(w)).length;
  return (words.length && hits / words.length >= 0.5) || /intuition|gut check|safe to ship|don'?t ship|ask a developer/.test(t);
}

function countPostReviewEdits(events) {
  // Find the last point where the Stop hook fed the review back, then count edit tools used afterwards.
  let idx = -1;
  events.forEach((e, i) => { if (/Comity Intuition|Intuition review/i.test(JSON.stringify(e)) && e.type !== "assistant" && e.type !== "result") idx = i; });
  if (idx === -1) return 0;
  let n = 0;
  for (const e of events.slice(idx + 1)) for (const part of e.message?.content ?? []) if (part.type === "tool_use" && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(part.name)) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------------------

function saveRun(entry) {
  // Several runner processes (one per reviewer) may finish together: serialise the read-modify-write.
  const lock = path.join(resultsDir, `.${date}.lock`);
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break; } catch { if (i > 600) fs.rmSync(lock, { recursive: true, force: true }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); }
  }
  try { saveRunLocked(entry); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

function saveRunLocked(entry) {
  const file = path.join(resultsDir, `${date}.json`);
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { date, runs: {} };
  const prev = all.runs[entry.key];
  if (prev && args.cases) {
    // partial re-run: merge per case
    const byId = new Map(prev.results.map((r) => [r.id, r]));
    for (const r of entry.results) byId.set(r.id, r);
    entry = { ...entry, results: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  }
  // Keep a one-line summary of every earlier run so re-runs after fixes show the trend.
  if (prev && prev.label !== entry.label) (all.history ??= []).push({ key: prev.key, label: prev.label, started_at: prev.started_at, summary: summarize(prev) });
  all.runs[entry.key] = entry;
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
  fs.writeFileSync(path.join(resultsDir, `${date}.md`), renderMarkdown(all));
  log(`wrote ${path.join(resultsDir, `${date}.md`)}`);
}

function printSummary(entry) {
  for (const r of entry.results) {
    const miss = (r.findings ?? []).filter((f) => !f.found).map((f) => f.label);
    log(`${r.pass ? "PASS" : "FAIL"} ${r.id} verdict=${r.verdict ?? "-"} found=${r.found ?? 0}/${r.expected ?? "?"} fp=${r.false_positives?.length ?? "-"} read=${r.readability?.score ?? "-"} ${r.error ?? ""}${miss.length ? " missed: " + miss.join("; ") : ""}`);
  }
}

function makeShims() {
  const dir = path.join(workDir, "_bin");
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ["comity-intuition", "intuition"]) {
    fs.writeFileSync(path.join(dir, `${name}.cmd`), `@echo off\r\n"${process.execPath}" "${cli}" %*\r\n`);
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nexec "${process.execPath.replace(/\\/g, "/")}" "${cli.replace(/\\/g, "/")}" "$@"\n`, { mode: 0o755 });
  }
  return dir;
}

function exec(cmd, argv, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

function killTree(pid) {
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  else try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); } catch (e) { out[i] = { id: items[i].id, title: items[i].title, kind: items[i].kind, error: String(e?.stack ?? e), pass: false }; }
      log(`  done ${items[i].id}: ${out[i].pass ? "pass" : "FAIL"}`);
    }
  }));
  return out;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    if (argv[i + 1] && !argv[i + 1].startsWith("--")) o[k] = argv[++i];
    else o[k] = true;
  }
  return o;
}

function tail(s, n = 2000) { return (s ?? "").slice(-n); }
function log(m) { process.stderr.write(m + "\n"); }
function die(m) { log(m); process.exit(2); }

function parseStream(text) {
  return text.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
