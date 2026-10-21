import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findRepoRoot } from "../src/git.js";
import { handleHook } from "../src/hook.js";
import { canonicalPath } from "../src/paths.js";
import type { ReviewerRequest, ReviewerResult } from "../src/reviewers.js";
import { cleanup, SAMPLE_CONTENT, tempDir, tempRepo, write } from "./helpers.js";

/**
 * Regression: the folder an agent or user works in can be an alias of the real repo folder
 * (macOS /var -> /private/var, Windows 8.3 short names, symlinks, junctions). git reports the real
 * path, so every comparison must happen on canonical paths. A symlink (junction on Windows) works on every OS.
 */
const CLI = resolve(__dirname, "..", "dist", "cli.js");
const dirs: string[] = [];
beforeEach(() => {
  const home = tempDir();
  dirs.push(home);
  vi.stubEnv("INTUITION_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  dirs.splice(0).forEach(cleanup);
});

function aliasedRepo() {
  const repo = tempRepo({ "src/app.js": "export const price = 10;\n" });
  const holder = tempDir();
  const alias = join(holder, "alias-of-repo");
  symlinkSync(repo, alias, process.platform === "win32" ? "junction" : "dir");
  dirs.push(holder, repo);
  return { repo, alias };
}

describe("canonical paths", () => {
  it("canonicalPath resolves aliases and returns missing paths unchanged", () => {
    const { repo, alias } = aliasedRepo();
    expect(canonicalPath(alias)).toBe(repo);
    expect(canonicalPath(join(alias, "src"))).toBe(`${repo}/src`);
    const missing = join(alias, "not-there");
    expect(canonicalPath(missing)).toBe(missing);
  });

  it("findRepoRoot gives the real repo folder from an aliased subfolder", async () => {
    const { repo, alias } = aliasedRepo();
    expect(await findRepoRoot(join(alias, "src"))).toBe(repo);
  });

  it("init run from the alias prints paths relative to where you are", () => {
    const { repo, alias } = aliasedRepo();
    const res = spawnSync(process.execPath, [CLI, "init"], { cwd: alias, encoding: "utf8", env: { ...process.env } });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Created \.claude[\\/]settings\.json/);
    expect(res.stdout).toMatch(/Reports folder: \.intuition[\\/]reports/);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(true);
  });

  it("the Stop hook works when the agent reports an aliased cwd, and keeps that cwd for forking", async () => {
    const { repo, alias } = aliasedRepo();
    const calls: ReviewerRequest[] = [];
    const runner = async (req: ReviewerRequest): Promise<ReviewerResult> => {
      calls.push(req);
      return { content: SAMPLE_CONTENT, model: "m", forkedFrom: req.forkSession };
    };
    const input = { session_id: "s", cwd: alias, stop_hook_active: false };
    const env = { CLAUDE_PROJECT_DIR: alias };
    await handleHook("prompt", "claude", input, { env });
    write(repo, "src/app.js", "export const price = 0;\n");
    const res = await handleHook("stop", "claude", input, { runner, env });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.cwd).toBe(alias);
    const html = /Full report: (.+\.html)$/.exec(res.output!.systemMessage!)![1]!;
    const report = JSON.parse(readFileSync(html.replace(/\.html$/, ".json"), "utf8"));
    expect(report.repo).toBe(repo);
    expect(report.files_reviewed).toEqual(["src/app.js"]);
    expect((await handleHook("stop", "claude", input, { runner, env })).skipped).toBe("already-reviewed");
  });
});
