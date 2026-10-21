// Materialises eval cases (eval/cases/<id>/{case.json,base/,change/}) as real git repos.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CASES_DIR = path.join(EVAL_DIR, "cases");
export const DEFAULT_WORK_DIR = path.join(os.tmpdir(), "comity-intuition-eval");

const GIT_ENV = {
  GIT_AUTHOR_NAME: "Sam Builder",
  GIT_AUTHOR_EMAIL: "sam@example.com",
  GIT_COMMITTER_NAME: "Sam Builder",
  GIT_COMMITTER_EMAIL: "sam@example.com",
  GIT_AUTHOR_DATE: "2026-10-01T09:00:00Z",
  GIT_COMMITTER_DATE: "2026-10-01T09:00:00Z",
};

export function git(cwd, args, extraEnv = {}) {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: { ...process.env, ...GIT_ENV, ...extraEnv },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function loadCases(filter = []) {
  const ids = fs.readdirSync(CASES_DIR).filter((d) => fs.existsSync(path.join(CASES_DIR, d, "case.json"))).sort();
  return ids
    .filter((id) => filter.length === 0 || filter.some((f) => id === f || id.startsWith(f)))
    .map((id) => ({ ...JSON.parse(fs.readFileSync(path.join(CASES_DIR, id, "case.json"), "utf8")), dir: path.join(CASES_DIR, id) }));
}

function copyTree(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dst, { recursive: true, force: true });
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function applyChange(c, repo) {
  copyTree(path.join(c.dir, "change"), repo);
  for (const rel of c.delete ?? []) rmrf(path.join(repo, rel));
  // Large generated files (e.g. a vendored minified library) so big-diff handling is exercised without committing blobs.
  for (const g of c.generate ?? []) {
    const p = path.join(repo, g.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, pseudoMinifiedJs(g.bytes));
  }
}

function pseudoMinifiedJs(bytes) {
  let s = "/*! chartkit v4.2.1 | MIT */!function(t,e){";
  let x = 1;
  for (let i = 0; s.length < bytes; i++) {
    x = (x * 48271) % 2147483647;
    s += `var a${i.toString(36)}=function(n,r){return n${"+-*^|&"[x % 6]}r+${x % 997}};`;
    if (i % 40 === 0) s += `t.k${i}=function(o){for(var q=0;q<o.length;q++)o[q]=a${i.toString(36)}(o[q],${x % 31});return o};`;
  }
  return s + "}(this,{});\n";
}

function initRepo(c, repo) {
  rmrf(repo);
  fs.mkdirSync(repo, { recursive: true });
  copyTree(path.join(c.dir, "base"), repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", "Sam Builder"]);
  git(repo, ["config", "user.email", "sam@example.com"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "Initial commit"]);
}

/**
 * Build a case repo.
 *  - variant "manual": base commit + change (uncommitted in the working tree, or a second commit when mode=commit).
 *    Returns the extra review args (e.g. --since HEAD~1).
 *  - variant "hook": base commit only; for red cases the change is exported as a patch file the builder agent applies.
 */
export function buildCase(c, workDir, variant = "manual") {
  const repo = path.join(workDir, c.id);
  initRepo(c, repo);
  if (variant === "manual") {
    applyChange(c, repo);
    if (c.mode === "commit") {
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", c.commit_message ?? "Change"], { GIT_AUTHOR_DATE: "2026-10-02T09:00:00Z", GIT_COMMITTER_DATE: "2026-10-02T09:00:00Z" });
      return { repo, reviewArgs: ["--since", "HEAD~1"] };
    }
    return { repo, reviewArgs: [] };
  }
  let patch = null;
  if (c.kind === "red" || c.hook?.patch) {
    applyChange(c, repo);
    git(repo, ["add", "-A", "-N"]);
    const diff = git(repo, ["diff", "--binary", "HEAD"]);
    patch = path.join(workDir, `${c.id}.patch`);
    fs.writeFileSync(patch, diff);
    git(repo, ["reset", "-q", "--hard", "HEAD"]);
    git(repo, ["clean", "-qfdx"]);
  }
  return { repo, patch, reviewArgs: [] };
}
