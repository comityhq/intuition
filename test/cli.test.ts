import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, tempDir, tempRepo, write } from "./helpers.js";

/** End-to-end through the built CLI (npm test builds first). */
const CLI = resolve(__dirname, "..", "dist", "cli.js");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

function cli(args: string[], opts: { cwd: string; input?: string; env?: Record<string, string> }) {
  const home = tempDir();
  dirs.push(home);
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd,
    input: opts.input ?? "",
    encoding: "utf8",
    env: { ...process.env, INTUITION_HOME: home, ...opts.env },
  });
}

describe("hook command I/O", () => {
  it("prints nothing and exits 0 when the Stop hook is already active", () => {
    const repo = tempRepo();
    dirs.push(repo);
    write(repo, "a.txt", "changed\n");
    const res = cli(["hook", "stop", "--agent", "claude"], {
      cwd: repo,
      input: JSON.stringify({ session_id: "s", cwd: repo, hook_event_name: "Stop", stop_hook_active: true }),
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("prints nothing inside a reviewer run, even with changes", () => {
    const repo = tempRepo();
    dirs.push(repo);
    write(repo, "a.txt", "changed\n");
    const res = cli(["hook", "stop", "--agent", "codex"], {
      cwd: repo,
      input: JSON.stringify({ session_id: "s", cwd: repo }),
      env: { COMITY_INTUITION_REVIEWER_RUN: "1" },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("prompt hook records the turn's starting point and stays silent", () => {
    const repo = tempRepo();
    dirs.push(repo);
    const res = cli(["hook", "prompt", "--agent", "claude"], { cwd: repo, input: JSON.stringify({ session_id: "s1", cwd: repo, prompt: "hi" }) });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    const state = JSON.parse(readFileSync(join(repo, ".intuition", "state.json"), "utf8"));
    expect(state.sessions.s1.turnBase).toMatch(/^[0-9a-f]{40}$/);
  });

  it("survives empty or broken stdin", () => {
    const repo = tempRepo();
    dirs.push(repo);
    for (const input of ["", "{nope"]) {
      const res = cli(["hook", "stop"], { cwd: repo, input });
      expect(res.status).toBe(0);
      expect(res.stdout).toBe("");
    }
  });
});

describe("commands", () => {
  it("init is idempotent and uninstall cleans up", () => {
    const repo = tempRepo();
    dirs.push(repo);
    expect(cli(["init"], { cwd: repo }).stdout).toContain("Created .claude");
    expect(cli(["init"], { cwd: repo }).stdout).toContain("Already up to date");
    expect(readFileSync(join(repo, ".intuition", ".gitignore"), "utf8")).toContain("*");
    expect(cli(["uninstall"], { cwd: repo }).stdout).toContain("Removed hooks from");
    expect(JSON.parse(readFileSync(join(repo, ".claude", "settings.json"), "utf8"))).toEqual({});
  });

  it("review exits 2 when there is nothing to review", () => {
    const repo = tempRepo();
    dirs.push(repo);
    const res = cli(["review", "--json"], { cwd: repo });
    expect(res.status).toBe(2);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("no code changes");
  });

  it("explains usage mistakes in plain words", () => {
    const repo = tempRepo();
    dirs.push(repo);
    const bad = cli(["review", "--reviewer", "gpt"], { cwd: repo });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("--reviewer must be one of: same, claude, codex, gemini");
    const outside = tempDir();
    dirs.push(outside);
    expect(cli(["review"], { cwd: outside }).stderr).toContain("isn't inside a git repository");
  });
});
