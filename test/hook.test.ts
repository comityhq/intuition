import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleHook, parseHookInput, type HookInput } from "../src/hook.js";
import { ReviewerError, REVIEWER_ENV, type ReviewerRequest, type ReviewerResult } from "../src/reviewers.js";
import { cleanup, SAMPLE_CONTENT, tempDir, tempRepo, write } from "./helpers.js";

const dirs: string[] = [];
let home: string;

beforeEach(() => {
  home = tempDir();
  dirs.push(home);
  vi.stubEnv("INTUITION_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  dirs.splice(0).forEach(cleanup);
});

function setup() {
  const repo = tempRepo({ "src/app.js": "export const price = 10;\n" });
  dirs.push(repo);
  const calls: ReviewerRequest[] = [];
  const runner = vi.fn(async (req: ReviewerRequest): Promise<ReviewerResult> => {
    calls.push(req);
    return { content: SAMPLE_CONTENT, model: "test-model", forkedFrom: req.forkSession };
  });
  const input: HookInput = { session_id: "sess-1", transcript_path: null, cwd: repo, stop_hook_active: false };
  const env = { CLAUDE_PROJECT_DIR: repo } as NodeJS.ProcessEnv;
  return { repo, runner, calls, input, env, open: vi.fn() };
}

describe("parseHookInput", () => {
  it("reads hook JSON, tolerating a BOM, and never throws on junk", () => {
    expect(parseHookInput('\uFEFF{"session_id":"a","stop_hook_active":true}')).toEqual({ session_id: "a", stop_hook_active: true });
    expect(parseHookInput("not json")).toEqual({});
    expect(parseHookInput("")).toEqual({});
    expect(parseHookInput("[1,2]")).toEqual({});
  });
});

describe("Stop hook: loop prevention", () => {
  it("does nothing inside a reviewer process", async () => {
    const t = setup();
    write(t.repo, "src/app.js", "export const price = 0;\n");
    const res = await handleHook("stop", "claude", t.input, { runner: t.runner, env: { ...t.env, [REVIEWER_ENV]: "1" } });
    expect(res).toEqual({ output: null, skipped: "inside-reviewer" });
    expect(t.runner).not.toHaveBeenCalled();
  });

  it("does nothing when the agent is already continuing because of a Stop hook", async () => {
    const t = setup();
    write(t.repo, "src/app.js", "export const price = 0;\n");
    const res = await handleHook("stop", "claude", { ...t.input, stop_hook_active: true }, { runner: t.runner, env: t.env });
    expect(res.skipped).toBe("stop-hook-active");
    expect(t.runner).not.toHaveBeenCalled();
  });

  it("never reviews the same working tree twice", async () => {
    const t = setup();
    await handleHook("prompt", "claude", t.input, { env: t.env });
    write(t.repo, "src/app.js", "export const price = 0;\n");
    const first = await handleHook("stop", "claude", t.input, { runner: t.runner, env: t.env, open: t.open });
    expect(first.output).not.toBeNull();
    const second = await handleHook("stop", "claude", t.input, { runner: t.runner, env: t.env, open: t.open });
    expect(second).toEqual({ output: null, skipped: "already-reviewed" });
    expect(t.runner).toHaveBeenCalledTimes(1);
  });

  it("skips turns that changed no code", async () => {
    const t = setup();
    await handleHook("prompt", "claude", t.input, { env: t.env });
    const res = await handleHook("stop", "claude", t.input, { runner: t.runner, env: t.env });
    expect(res).toEqual({ output: null, skipped: "no-changes" });
    expect(t.runner).not.toHaveBeenCalled();
  });

  it("respects enabled=false", async () => {
    const t = setup();
    write(t.repo, ".intuition/config.json", JSON.stringify({ enabled: false }));
    write(t.repo, "src/app.js", "export const price = 0;\n");
    expect((await handleHook("stop", "claude", t.input, { runner: t.runner, env: t.env })).skipped).toBe("disabled");
  });

  it("ignores folders that aren't git repositories", async () => {
    const t = setup();
    const outside = tempDir();
    dirs.push(outside);
    const res = await handleHook("stop", "claude", { ...t.input, cwd: outside }, { runner: t.runner, env: t.env });
    expect(res.skipped).toBe("not-a-git-repo");
  });
});

describe("Stop hook: review and presentation", () => {
  it("forks the Claude session, saves the report and hands the review back via additionalContext", async () => {
    const t = setup();
    await handleHook("prompt", "claude", t.input, { env: t.env });
    write(t.repo, "src/app.js", "export const price = 0;\n");
    write(t.repo, "src/new.js", "export const x = 1;\n");
    const res = await handleHook("stop", "claude", { ...t.input, last_assistant_message: "Done." }, { runner: t.runner, env: t.env });

    expect(t.calls[0]).toMatchObject({ agent: "claude", forkSession: "sess-1", cwd: t.repo });
    expect(t.calls[0]!.prompt).toContain("forked");
    expect(t.calls[0]!.prompt).toContain("src/new.js");

    const out = res.output!;
    expect(out.decision).toBeUndefined();
    expect(out.hookSpecificOutput?.hookEventName).toBe("Stop");
    expect(out.hookSpecificOutput?.additionalContext).toContain("Do not change code");
    expect(out.hookSpecificOutput?.additionalContext).toContain("Verdict: YELLOW");
    expect(out.systemMessage).toMatch(/^Comity Intuition: YELLOW/);

    const htmlPath = /Full report: (.+\.html)$/.exec(out.systemMessage!)?.[1];
    expect(htmlPath && existsSync(htmlPath)).toBe(true);
    const report = JSON.parse(readFileSync(htmlPath!.replace(/\.html$/, ".json"), "utf8"));
    expect(report).toMatchObject({
      version: 1,
      reviewer: { agent: "claude", model: "test-model", forked_from_session: "sess-1" },
      files_reviewed: ["src/app.js", "src/new.js"],
      truncated: false,
    });
    expect(report.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("only reviews what changed during the turn, not earlier edits", async () => {
    const t = setup();
    write(t.repo, "notes.txt", "user's own edit before the turn\n");
    await handleHook("prompt", "claude", t.input, { env: t.env });
    write(t.repo, "src/app.js", "export const price = 0;\n");
    await handleHook("stop", "claude", t.input, { runner: t.runner, env: t.env });
    expect(t.calls[0]!.prompt).toContain("src/app.js");
    expect(t.calls[0]!.prompt).not.toContain("notes.txt");
  });

  it("uses decision=block for Codex, which turns the reason into the next prompt", async () => {
    const t = setup();
    await handleHook("prompt", "codex", t.input, { env: t.env });
    write(t.repo, "src/app.js", "export const price = 0;\n");
    const res = await handleHook("stop", "codex", t.input, { runner: t.runner, env: t.env });
    expect(res.output).toMatchObject({ decision: "block" });
    expect(res.output?.reason).toContain("[Comity Intuition]");
    expect(t.calls[0]).toMatchObject({ agent: "codex", forkSession: "sess-1" });
  });

  it("cross-vendor reviewer gets the transcript instead of a fork", async () => {
    const t = setup();
    write(t.repo, ".intuition/config.json", JSON.stringify({ reviewer: "codex" }));
    const transcript = join(home, "transcript.jsonl");
    write(home, "transcript.jsonl", `${JSON.stringify({ type: "user", message: { role: "user", content: "Please add a 50% staff discount" } })}\n`);
    write(t.repo, "src/app.js", "export const price = 5;\n");
    await handleHook("stop", "claude", { ...t.input, transcript_path: transcript }, { runner: t.runner, env: t.env });
    expect(t.calls[0]).toMatchObject({ agent: "codex", forkSession: null });
    expect(t.calls[0]!.prompt).toContain("Please add a 50% staff discount");
  });

  it("presentInChat=false only shows the one-line status", async () => {
    const t = setup();
    write(t.repo, ".intuition/config.json", JSON.stringify({ presentInChat: false }));
    write(t.repo, "src/app.js", "export const price = 0;\n");
    const res = await handleHook("stop", "claude", t.input, { runner: t.runner, env: t.env });
    expect(Object.keys(res.output!)).toEqual(["systemMessage"]);
  });

  it("reports a failed review without blocking, and retries those changes next turn", async () => {
    const t = setup();
    const failing = vi.fn(async () => {
      throw new ReviewerError("Claude Code took too long and was stopped");
    });
    await handleHook("prompt", "claude", t.input, { env: t.env });
    write(t.repo, "src/app.js", "export const price = 0;\n");
    const res = await handleHook("stop", "claude", t.input, { runner: failing, env: t.env });
    expect(res.output).toEqual({ systemMessage: expect.stringContaining("couldn't review this turn") });
    expect(readFileSync(join(t.repo, ".intuition", "hook.log"), "utf8")).toContain("review failed");

    const retry = await handleHook("stop", "claude", t.input, { runner: t.runner, env: t.env });
    expect(retry.output?.hookSpecificOutput).toBeDefined();
    expect(t.calls[0]!.prompt).toContain("src/app.js");
  });

  it("still shows the main review when the second opinion fails, and says why in the status line", async () => {
    const t = setup();
    write(t.repo, ".intuition/config.json", JSON.stringify({ secondOpinion: "codex" }));
    write(t.repo, "src/app.js", "export const price = 0;\n");
    const runner = vi.fn(async (req: ReviewerRequest): Promise<ReviewerResult> => {
      if (req.agent === "codex") throw new ReviewerError("Codex reviewer failed (exit 1): You've hit your usage limit");
      return { content: SAMPLE_CONTENT, model: "m", forkedFrom: req.forkSession };
    });
    const res = await handleHook("stop", "claude", t.input, { runner, env: t.env });
    expect(res.output?.hookSpecificOutput?.additionalContext).toContain("Verdict: YELLOW");
    expect(res.output?.hookSpecificOutput?.additionalContext).not.toContain("usage limit");
    expect(res.output?.systemMessage).toContain("Second opinion skipped: Codex reviewer failed (exit 1): You've hit your usage limit");
  });

  it("runs a second opinion in parallel and mentions both", async () => {
    const t = setup();
    write(t.repo, ".intuition/config.json", JSON.stringify({ secondOpinion: "codex" }));
    write(t.repo, "src/app.js", "export const price = 0;\n");
    const res = await handleHook("stop", "claude", t.input, { runner: t.runner, env: t.env });
    expect(t.calls.map((c) => c.agent).sort()).toEqual(["claude", "codex"]);
    expect(res.output?.systemMessage).toContain("Second opinion (Codex)");
    expect(res.output?.hookSpecificOutput?.additionalContext).toContain("Second opinion from Codex");
  });
});
