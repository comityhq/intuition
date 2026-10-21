import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, type Config } from "./config.js";
import { findRepoRoot, resolveTreeish, snapshotWorkingTree } from "./git.js";
import { canonicalPath, ensureIntuitionDir, intuitionDir } from "./paths.js";
import { chatPresentation, statusLine, type PresentedReview } from "./present.js";
import type { AgentId } from "./report/types.js";
import { NoChangesError, resolveReviewer, runReview, type BuilderSession, type ReviewerRunner } from "./review.js";
import { REVIEWER_ENV, runReviewer } from "./reviewers.js";
import { loadState, saveState, touchSession } from "./state.js";
import { openInBrowser } from "./open.js";

/** Fields we read from Claude Code / Codex hook input (both use the same names). */
export interface HookInput {
  session_id?: string;
  transcript_path?: string | null;
  cwd?: string;
  hook_event_name?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string | null;
}

/** What we print on stdout. Shapes follow the Claude Code / Codex Stop-hook contracts. */
export interface HookOutput {
  systemMessage?: string;
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: { hookEventName: "Stop"; additionalContext: string };
}

export type HookEvent = "prompt" | "stop";

export interface HookDeps {
  runner?: ReviewerRunner;
  env?: NodeJS.ProcessEnv;
  open?: (path: string) => void;
}

export async function hookLog(repo: string, message: string): Promise<void> {
  await appendFile(join(intuitionDir(repo), "hook.log"), `${new Date().toISOString()} ${message}\n`).catch(() => undefined);
}

export function parseHookInput(raw: string): HookInput {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as unknown;
    // Hook input is a JSON object from the agent; fields are read defensively (each may be missing).
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const input: HookInput = parsed;
    return input;
  } catch {
    return {};
  }
}

/** Why a Stop hook did nothing; used for logs and tests. */
export type SkipReason =
  | "inside-reviewer"
  | "stop-hook-active"
  | "not-a-git-repo"
  | "disabled"
  | "no-changes"
  | "already-reviewed";

export interface HookResult {
  output: HookOutput | null;
  skipped?: SkipReason;
}

/**
 * The agent's project directory: Claude Code exports CLAUDE_PROJECT_DIR (where its session lives); else hook cwd.
 * Deliberately NOT canonicalized: Claude Code finds a session to fork by the exact folder spelling it started in,
 * so the reviewer must run in that same spelling. Everything we compare uses the canonical repo root instead.
 */
function agentCwd(agent: AgentId, input: HookInput, env: NodeJS.ProcessEnv): string | null {
  return (agent === "claude" ? env.CLAUDE_PROJECT_DIR : undefined) ?? input.cwd ?? null;
}

const transcriptOf = (input: HookInput) => (input.transcript_path ? canonicalPath(input.transcript_path) : null);

/** UserPromptSubmit: remember the working tree as it was before the agent starts this turn. */
async function onPrompt(agent: AgentId, input: HookInput, repo: string, env: NodeJS.ProcessEnv): Promise<HookResult> {
  const sessionId = input.session_id ?? "unknown";
  await ensureIntuitionDir(repo);
  const state = await loadState(repo);
  const session = touchSession(state, sessionId, agent, transcriptOf(input), agentCwd(agent, input, env));
  // Keep an older base if the previous turn never reached Stop (interrupted), so its changes still get reviewed.
  if (!session.turnBase) session.turnBase = (await snapshotWorkingTree(repo)).tree;
  await saveState(repo, state);
  return { output: null };
}

async function onStop(agent: AgentId, input: HookInput, repo: string, config: Config, deps: HookDeps): Promise<HookResult> {
  const sessionId = input.session_id ?? "unknown";
  const env = deps.env ?? process.env;
  const cwd = agentCwd(agent, input, env) ?? repo;
  await ensureIntuitionDir(repo);
  const state = await loadState(repo);
  const session = touchSession(state, sessionId, agent, transcriptOf(input), cwd);
  const snapshot = await snapshotWorkingTree(repo);
  const base = session.turnBase ?? session.lastReviewed ?? (await resolveTreeish(repo, "HEAD"));
  const baseTree = await resolveTreeish(repo, `${base}^{tree}`).catch(() => base);

  if (snapshot.tree === session.lastReviewed || snapshot.tree === baseTree) {
    const skipped: SkipReason = snapshot.tree === session.lastReviewed ? "already-reviewed" : "no-changes";
    session.turnBase = null;
    session.lastReviewed ??= snapshot.tree;
    await saveState(repo, state);
    return { output: null, skipped };
  }

  // Claim this snapshot before the (slow) review so a second Stop can't review it twice.
  session.turnBase = null;
  session.lastTurnBase = base;
  session.lastReviewed = snapshot.tree;
  await saveState(repo, state);

  const builder: BuilderSession = {
    agent,
    sessionId: input.session_id ?? null,
    transcriptPath: transcriptOf(input),
    lastMessage: input.last_assistant_message ?? null,
  };
  const primaryAgent = resolveReviewer(config.reviewer, builder);
  const secondAgent = config.secondOpinion !== "none" && config.secondOpinion !== primaryAgent ? config.secondOpinion : null;
  const job = (reviewer: AgentId) =>
    runReview(
      { repo, cwd, base, snapshot, reportHead: snapshot.tree, reviewer, builder, config, scope: "the changes made during the coding agent's last turn" },
      deps.runner ?? runReviewer,
    );

  const [primary, second] = await Promise.allSettled([job(primaryAgent), secondAgent ? job(secondAgent) : Promise.resolve(null)]);
  if (primary.status === "rejected") {
    if (primary.reason instanceof NoChangesError) return { output: null, skipped: "no-changes" };
    // Give the next turn a chance to review these changes again.
    const fresh = await loadState(repo);
    const s = fresh.sessions[sessionId];
    if (s && s.lastReviewed === snapshot.tree) {
      s.lastReviewed = null;
      s.turnBase = base;
      await saveState(repo, fresh);
    }
    const message = (primary.reason as Error).message;
    await hookLog(repo, `review failed (${primaryAgent}): ${message}`);
    return { output: { systemMessage: `Comity Intuition couldn't review this turn: ${message}` } };
  }

  const main: PresentedReview = { report: primary.value.report, htmlPath: primary.value.paths.html };
  let extra: PresentedReview | undefined;
  let secondFailure = "";
  if (second.status === "fulfilled" && second.value) {
    extra = { report: second.value.report, htmlPath: second.value.paths.html };
  } else if (second.status === "rejected") {
    const message = second.reason instanceof Error ? second.reason.message : String(second.reason);
    await hookLog(repo, `second opinion failed (${secondAgent}): ${message}`);
    secondFailure = ` | Second opinion skipped: ${message.slice(0, 300)}`;
  }
  await hookLog(repo, `reviewed ${main.report.files_reviewed.length} file(s): ${main.report.verdict} ${main.report.id}`);
  if (config.openReport) (deps.open ?? openInBrowser)(main.htmlPath);

  const systemMessage = `${statusLine(main, extra)}${secondFailure}`;
  if (!config.presentInChat) return { output: { systemMessage } };
  const text = chatPresentation(main, extra);
  // Claude Code: additionalContext continues the turn without an error banner. Codex: block + reason does the same.
  return {
    output:
      agent === "claude"
        ? { systemMessage, hookSpecificOutput: { hookEventName: "Stop", additionalContext: text } }
        : { systemMessage, decision: "block", reason: text },
  };
}

/** Entry point for `comity-intuition hook <prompt|stop> --agent <claude|codex>`. Never throws. */
export async function handleHook(event: HookEvent, agent: AgentId, input: HookInput, deps: HookDeps = {}): Promise<HookResult> {
  const env = deps.env ?? process.env;
  if (env[REVIEWER_ENV] === "1") return { output: null, skipped: "inside-reviewer" };
  if (event === "stop" && input.stop_hook_active) return { output: null, skipped: "stop-hook-active" };
  const repo = await findRepoRoot(input.cwd ?? process.cwd());
  if (!repo) return { output: null, skipped: "not-a-git-repo" };
  try {
    const config = await loadConfig(repo);
    if (!config.enabled) return { output: null, skipped: "disabled" };
    return event === "prompt" ? await onPrompt(agent, input, repo, env) : await onStop(agent, input, repo, config, deps);
  } catch (err) {
    await hookLog(repo, `hook ${event} error: ${(err as Error).stack ?? err}`);
    return event === "stop"
      ? { output: { systemMessage: `Comity Intuition hit a problem and skipped this review: ${(err as Error).message}` } }
      : { output: null };
  }
}
