import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.js";
import { which, run, type RunResult } from "./proc.js";
import { extractJsonObject, normalizeReview } from "./report/normalize.js";
import { REVIEW_CONTENT_SCHEMA, type AgentId, type ReviewContent } from "./report/types.js";
import { AGENT_NAME } from "./report/render.js";

/** Set in every reviewer process so our own hooks inside it exit immediately (no review-of-the-review loops). */
export const REVIEWER_ENV = "COMITY_INTUITION_REVIEWER_RUN";

export class ReviewerError extends Error {}

export interface ReviewerRequest {
  agent: AgentId;
  /** Directory the reviewer runs in (the builder's project dir when forking). */
  cwd: string;
  prompt: string;
  config: Config;
  /** Same-vendor session to fork, so the reviewer remembers the work. null = fresh reviewer. */
  forkSession: string | null;
}

export interface ReviewerResult {
  content: ReviewContent;
  model: string | null;
  forkedFrom: string | null;
}

/** Read-only tool set for Claude reviewers; everything that can change files or run code is removed. */
export const CLAUDE_REVIEWER_TOOLS = "Read,Grep,Glob";
const CLAUDE_DENIED_TOOLS = "Edit,Write,NotebookEdit,Bash,PowerShell,WebFetch,WebSearch,Agent,Task";

export const AGENT_BINARIES: Record<AgentId, string> = { claude: "claude", codex: "codex", gemini: "gemini" };

export function agentBinary(agent: AgentId): string | null {
  const override = process.env[`INTUITION_${agent.toUpperCase()}_BIN`];
  return override ? (which(override) ?? override) : which(AGENT_BINARIES[agent]);
}

function failure(agent: AgentId, res: RunResult, detail?: string): ReviewerError {
  const name = AGENT_NAME[agent];
  if (res.timedOut) return new ReviewerError(`${name} took too long and was stopped (timeoutSec). Try again, or raise it with: comity-intuition config set timeoutSec 600`);
  const tail = (detail || res.stderr || res.stdout).trim().split(/\r?\n/).slice(-4).join(" ").slice(0, 600);
  // Plan limits are the most common cross-vendor failure: say so plainly and point at a reviewer that still works.
  const hint = /usage limit|rate limit|quota|too many requests|\b429\b/i.test(`${tail} ${res.stderr}`)
    ? ` (your ${name} plan's usage limit is reached; until it resets, use another reviewer, e.g. --reviewer same or: comity-intuition config set reviewer same)`
    : "";
  return new ReviewerError(`${name} reviewer failed${res.code !== null ? ` (exit ${res.code})` : ""}: ${tail || "no output"}${hint}`);
}

function claudeArgs(req: ReviewerRequest): string[] {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(REVIEW_CONTENT_SCHEMA),
    "--tools",
    CLAUDE_REVIEWER_TOOLS,
    "--disallowedTools",
    CLAUDE_DENIED_TOOLS,
    "--permission-mode",
    "dontAsk",
    "--strict-mcp-config",
    "--settings",
    JSON.stringify({ disableAllHooks: true }),
    "--no-session-persistence",
  ];
  if (req.forkSession) args.push("--resume", req.forkSession, "--fork-session");
  if (req.config.claudeModel) args.push("--model", req.config.claudeModel);
  if (req.config.claudeSettingSources) args.push("--setting-sources", req.config.claudeSettingSources);
  return args;
}

/** Narrow parsed JSON to a plain object, or an empty one. */
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

/** Parse `claude -p --output-format json` output into review content + model. Exported for tests. */
export function parseClaudeOutput(stdout: string): { content: ReviewContent; model: string | null } {
  const result = asObject(extractJsonObject(stdout));
  if (result.is_error === true || (result.subtype && result.subtype !== "success")) {
    throw new ReviewerError(`Claude Code reported an error: ${String(result.result ?? result.subtype ?? "unknown").slice(0, 400)}`);
  }
  const raw = result.structured_output ?? extractJsonObject(String(result.result ?? ""));
  // The main model is the one that wrote the most output (Claude Code may also use a small helper model).
  const tokens = (usage: unknown) => {
    const out = asObject(usage).outputTokens;
    return typeof out === "number" ? out : 0;
  };
  const model = Object.entries(asObject(result.modelUsage)).sort((a, b) => tokens(b[1]) - tokens(a[1]))[0]?.[0] ?? null;
  return { content: normalizeReview(raw), model };
}

async function runClaude(req: ReviewerRequest, bin: string): Promise<ReviewerResult> {
  const res = await run(bin, claudeArgs(req), {
    cwd: req.cwd,
    input: req.prompt,
    env: { [REVIEWER_ENV]: "1" },
    timeoutMs: req.config.timeoutSec * 1000,
  });
  if (res.timedOut || !res.stdout.trim()) throw failure("claude", res);
  try {
    const { content, model } = parseClaudeOutput(res.stdout);
    return { content, model, forkedFrom: req.forkSession };
  } catch (err) {
    throw err instanceof ReviewerError ? err : failure("claude", res, (err as Error).message);
  }
}

/** Find the model a Codex thread used, from its rollout file under CODEX_HOME/sessions. */
async function codexThreadModel(threadId: string): Promise<string | null> {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
  const days = [0, 1].map((back) => {
    const d = new Date(Date.now() - back * 86_400_000);
    return join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
  });
  for (const dir of days) {
    const name = (await readdir(dir).catch(() => [] as string[])).find((f) => f.endsWith(`${threadId}.jsonl`));
    if (!name) continue;
    const text = await readFile(join(dir, name), "utf8").catch(() => "");
    return /"thread_settings":\{"model":"([^"]+)"/.exec(text)?.[1] ?? /"model":"([^"]+)"/.exec(text)?.[1] ?? null;
  }
  return null;
}

async function runCodex(req: ReviewerRequest, bin: string): Promise<ReviewerResult> {
  const work = await mkdtemp(join(tmpdir(), "intuition-codex-"));
  try {
    const schemaFile = join(work, "schema.json");
    const lastFile = join(work, "last.json");
    await writeFile(schemaFile, JSON.stringify(REVIEW_CONTENT_SCHEMA));
    const common = [
      "--json",
      "--skip-git-repo-check",
      "-c",
      'approval_policy="never"',
      "-c",
      "features.hooks=false",
      "--output-schema",
      schemaFile,
      "-o",
      lastFile,
    ];
    if (req.config.codexModel) common.push("-m", req.config.codexModel);
    if (req.config.codexIgnoreUserConfig) common.push("--ignore-user-config");
    const args = req.forkSession
      ? ["exec", "fork", req.forkSession, ...common, "-c", 'sandbox_mode="read-only"', "-"]
      : ["exec", ...common, "--sandbox", "read-only", "-C", req.cwd, "-"];
    const res = await run(bin, args, {
      cwd: req.cwd,
      input: req.prompt,
      env: { [REVIEWER_ENV]: "1" },
      timeoutMs: req.config.timeoutSec * 1000,
    });
    const last = await readFile(lastFile, "utf8").catch(() => "");
    const threadId = /"thread_id":"([^"]+)"/.exec(res.stdout)?.[1] ?? null;
    if (!last.trim()) {
      const errors = [...res.stdout.matchAll(/"message":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).slice(-2).join(" ");
      throw failure("codex", res, errors || undefined);
    }
    let content: ReviewContent;
    try {
      content = normalizeReview(extractJsonObject(last));
    } catch (err) {
      throw failure("codex", res, (err as Error).message);
    }
    const model = req.config.codexModel ?? (threadId ? await codexThreadModel(threadId) : null);
    return { content, model, forkedFrom: req.forkSession };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function runGemini(req: ReviewerRequest, bin: string): Promise<ReviewerResult> {
  const args = ["--output-format", "json", "--approval-mode", "plan"];
  if (req.config.geminiModel) args.push("-m", req.config.geminiModel);
  args.push("-p", "Follow the review instructions above. Reply with the JSON object only.");
  const res = await run(bin, args, {
    cwd: req.cwd,
    input: req.prompt,
    env: { [REVIEWER_ENV]: "1" },
    timeoutMs: req.config.timeoutSec * 1000,
  });
  if (res.timedOut || !res.stdout.trim()) throw failure("gemini", res);
  try {
    const out = asObject(extractJsonObject(res.stdout));
    if (out.error) throw new ReviewerError(`Gemini CLI reported an error: ${String(asObject(out.error).message ?? "unknown")}`);
    const content = normalizeReview(extractJsonObject(typeof out.response === "string" ? out.response : ""));
    const model = Object.keys(asObject(asObject(out.stats).models))[0] ?? null;
    return { content, model: req.config.geminiModel ?? model, forkedFrom: null };
  } catch (err) {
    throw err instanceof ReviewerError ? err : failure("gemini", res, (err as Error).message);
  }
}

export async function runReviewer(req: ReviewerRequest): Promise<ReviewerResult> {
  const bin = agentBinary(req.agent);
  if (!bin) {
    throw new ReviewerError(
      `The ${req.agent} command isn't installed or isn't on PATH, so it can't review. Run "comity-intuition doctor" to see which reviewers are available.`,
    );
  }
  if (req.agent === "claude") return runClaude(req, bin);
  if (req.agent === "codex") return runCodex(req, bin);
  return runGemini(req, bin);
}
