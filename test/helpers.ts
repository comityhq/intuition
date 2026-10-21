import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalPath } from "../src/paths.js";
import type { ReviewContent } from "../src/report/types.js";

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function write(root: string, file: string, content: string | Buffer): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

/** A throwaway git repo with one commit containing `files`. Canonical path, like findRepoRoot reports it. */
export function tempRepo(files: Record<string, string> = { "README.md": "# demo\n" }, commit = true): string {
  const dir = tempDir();
  sh(dir, "init", "-q");
  sh(dir, "config", "user.email", "test@example.com");
  sh(dir, "config", "user.name", "Test");
  sh(dir, "config", "core.autocrlf", "false");
  for (const [f, c] of Object.entries(files)) write(dir, f, c);
  if (commit) {
    sh(dir, "add", "-A");
    sh(dir, "commit", "-qm", "initial");
  }
  return dir;
}

/** A fresh temp folder, canonical (tmpdir can be a symlink on macOS or an 8.3 short name on Windows). */
export function tempDir(): string {
  return canonicalPath(mkdtempSync(join(tmpdir(), "intuition-test-")));
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export const SAMPLE_CONTENT: ReviewContent = {
  verdict: "yellow",
  headline: "Checkout now charges $5 shipping outside the US; one thing to confirm.",
  what_changed: ["Customers outside the US pay a flat $5 shipping fee.", "A new STAFF50 discount code gives 50% off."],
  risks: [
    {
      level: "medium",
      category: "money",
      title: "Anyone can use the staff discount",
      explanation: "The STAFF50 code isn't limited to employees. If it is shared online, any customer gets half price.",
      where: ["src/pricing.js"],
      confidence: "high",
    },
  ],
  questions_for_developer: ["Can we limit STAFF50 to staff accounts?"],
  good_news: ["The change is small and easy to undo."],
};
