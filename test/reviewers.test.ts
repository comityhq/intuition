import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { runReviewer } from "../src/reviewers.js";
import { cleanup, SAMPLE_CONTENT, tempDir, write } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  dirs.splice(0).forEach(cleanup);
});

/**
 * A stand-in agent CLI: records argv, stdin and env, then prints `stdout`.
 * On Windows it is a .cmd shim (like npm-installed CLIs), which exercises our cmd.exe quoting.
 */
function fakeAgent(stdout: string): { bin: string; log: string } {
  const dir = tempDir();
  dirs.push(dir);
  const log = join(dir, "call.json");
  write(
    dir,
    "fake.mjs",
    `import { writeFileSync } from "node:fs";
let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", () => {
  writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), input, guard: process.env.COMITY_INTUITION_REVIEWER_RUN, cwd: process.cwd() }));
  process.stdout.write(${JSON.stringify(stdout)});
});`,
  );
  if (process.platform === "win32") {
    write(dir, "agent.cmd", `@echo off\r\nnode "%~dp0fake.mjs" %*\r\n`);
    return { bin: join(dir, "agent.cmd"), log };
  }
  write(dir, "agent", `#!/bin/sh\nexec node "$(dirname "$0")/fake.mjs" "$@"\n`);
  chmodSync(join(dir, "agent"), 0o755);
  return { bin: join(dir, "agent"), log };
}

describe("reviewer processes", () => {
  it("Gemini: read-only plan mode, prompt on stdin, model from stats", async () => {
    const fake = fakeAgent(JSON.stringify({ response: `\`\`\`json\n${JSON.stringify(SAMPLE_CONTENT)}\n\`\`\``, stats: { models: { "gemini-test": {} } } }));
    vi.stubEnv("INTUITION_GEMINI_BIN", fake.bin);
    const cwd = tempDir();
    dirs.push(cwd);
    const result = await runReviewer({ agent: "gemini", cwd, prompt: 'REVIEW "this" & that %PATH%', config: DEFAULT_CONFIG, forkSession: null });
    expect(result).toEqual({ content: SAMPLE_CONTENT, model: "gemini-test", forkedFrom: null });
    const call = JSON.parse(readFileSync(fake.log, "utf8"));
    expect(call.argv).toEqual([
      "--output-format",
      "json",
      "--approval-mode",
      "plan",
      "-p",
      "Follow the review instructions above. Reply with the JSON object only.",
    ]);
    expect(call.input).toBe('REVIEW "this" & that %PATH%');
    expect(call.guard).toBe("1");
  });

  it("Claude: read-only flags, fork arguments and structured output", async () => {
    const fake = fakeAgent(
      JSON.stringify({ type: "result", subtype: "success", structured_output: SAMPLE_CONTENT, modelUsage: { "claude-test": { outputTokens: 5 } } }),
    );
    vi.stubEnv("INTUITION_CLAUDE_BIN", fake.bin);
    const cwd = tempDir();
    dirs.push(cwd);
    const config = { ...DEFAULT_CONFIG, claudeModel: "sonnet", claudeSettingSources: "project,local" };
    const result = await runReviewer({ agent: "claude", cwd, prompt: "p", config, forkSession: "sess-9" });
    expect(result).toEqual({ content: SAMPLE_CONTENT, model: "claude-test", forkedFrom: "sess-9" });
    const { argv } = JSON.parse(readFileSync(fake.log, "utf8")) as { argv: string[] };
    const after = (flag: string) => argv[argv.indexOf(flag) + 1];
    expect(after("--tools")).toBe("Read,Grep,Glob");
    expect(after("--disallowedTools")).toContain("Edit,Write");
    expect(after("--disallowedTools")).toContain("Bash");
    expect(after("--permission-mode")).toBe("dontAsk");
    expect(after("--resume")).toBe("sess-9");
    expect(argv).toContain("--fork-session");
    expect(argv).toContain("--strict-mcp-config");
    expect(argv).toContain("--no-session-persistence");
    expect(JSON.parse(after("--settings")!)).toEqual({ disableAllHooks: true });
    expect(JSON.parse(after("--json-schema")!).required).toContain("verdict");
    expect(after("--model")).toBe("sonnet");
    expect(after("--setting-sources")).toBe("project,local");
  });

  it("recognises plan usage limits and suggests another reviewer", async () => {
    const dir = tempDir();
    dirs.push(dir);
    write(dir, "limit.mjs", 'process.stderr.write("ERROR: You\'ve hit your usage limit. Try again at Nov 17th.\\n"); process.exit(1);');
    const bin = process.platform === "win32" ? join(dir, "limit.cmd") : join(dir, "limit");
    write(dir, process.platform === "win32" ? "limit.cmd" : "limit", process.platform === "win32" ? `@node "%~dp0limit.mjs"\r\n` : `#!/bin/sh\nexec node "$(dirname "$0")/limit.mjs"\n`);
    if (process.platform !== "win32") chmodSync(bin, 0o755);
    vi.stubEnv("INTUITION_GEMINI_BIN", bin);
    await expect(runReviewer({ agent: "gemini", cwd: dir, prompt: "p", config: DEFAULT_CONFIG, forkSession: null })).rejects.toThrow(
      /usage limit is reached; until it resets, use another reviewer/,
    );
  });

  it("explains a missing agent in plain words", async () => {
    vi.stubEnv("INTUITION_CODEX_BIN", join(tempDir(), "no-such-codex.exe"));
    await expect(
      runReviewer({ agent: "codex", cwd: process.cwd(), prompt: "p", config: DEFAULT_CONFIG, forkSession: null }),
    ).rejects.toThrow(/Codex reviewer failed|isn't installed/);
  });

  // Real 1-second wait on purpose: this checks that a hung child *process tree* is killed, which fake timers can't simulate.
  it("stops a reviewer that takes too long", async () => {
    const dir = tempDir();
    dirs.push(dir);
    write(dir, "slow.mjs", "setTimeout(() => {}, 60_000);");
    const bin = process.platform === "win32" ? join(dir, "slow.cmd") : join(dir, "slow");
    write(dir, process.platform === "win32" ? "slow.cmd" : "slow", process.platform === "win32" ? `@node "%~dp0slow.mjs"\r\n` : `#!/bin/sh\nexec node "$(dirname "$0")/slow.mjs"\n`);
    if (process.platform !== "win32") chmodSync(bin, 0o755);
    vi.stubEnv("INTUITION_CLAUDE_BIN", bin);
    const started = Date.now();
    await expect(
      runReviewer({ agent: "claude", cwd: dir, prompt: "p", config: { ...DEFAULT_CONFIG, timeoutSec: 1 }, forkSession: null }),
    ).rejects.toThrow(/took too long/);
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
