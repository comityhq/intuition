import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.js";
import { captureDiff, snapshotWorkingTree, type CapturedDiff, type Snapshot } from "./git.js";
import { buildReviewPrompt } from "./prompt.js";
import { saveReport, newReportId, type SavedReport } from "./report/store.js";
import type { AgentId, Report } from "./report/types.js";
import { agentBinary, runReviewer, type ReviewerRequest, type ReviewerResult } from "./reviewers.js";
import { readTranscriptExcerpt } from "./transcript.js";

export class NoChangesError extends Error {
  constructor() {
    super("There are no code changes to review.");
  }
}

export interface BuilderSession {
  agent: AgentId;
  sessionId: string | null;
  transcriptPath: string | null;
  lastMessage: string | null;
}

export interface ReviewJob {
  repo: string;
  /** Where the reviewer process runs: the builder's project dir (needed to find a Claude session to fork). */
  cwd: string;
  /** Tree-ish the changes are measured from. */
  base: string;
  /** Working-tree snapshot to review; taken now when omitted. */
  snapshot?: Snapshot;
  /** Value for the report's "head" field (null = uncommitted working tree). */
  reportHead: string | null;
  reviewer: AgentId;
  builder: BuilderSession | null;
  config: Config;
  /** Plain-words description of what is being reviewed, for the prompt. */
  scope: string;
}

export interface ReviewOutcome {
  report: Report;
  paths: SavedReport;
  diff: CapturedDiff;
}

export type ReviewerRunner = (req: ReviewerRequest) => Promise<ReviewerResult>;

/** Pick the agent for "same": the builder's vendor, else the first installed of Claude Code, Codex, Gemini. */
export function resolveReviewer(choice: Config["reviewer"], builder: BuilderSession | null): AgentId {
  if (choice !== "same") return choice;
  if (builder) return builder.agent;
  return (["claude", "codex", "gemini"] as const).find((a) => agentBinary(a)) ?? "claude";
}

/** Diff, prompt, run the reviewer, save the report. `onStart` fires once the diff is known (before the slow part). */
export async function runReview(
  job: ReviewJob,
  runner: ReviewerRunner = runReviewer,
  onStart?: (diff: CapturedDiff) => void,
): Promise<ReviewOutcome> {
  const snapshot = job.snapshot ?? (await snapshotWorkingTree(job.repo));
  const notes = snapshot.skippedLarge.length ? [`Large new files not inspected: ${snapshot.skippedLarge.join(", ")}`] : [];
  const diff = await captureDiff(
    job.repo,
    job.base,
    snapshot.tree,
    { maxChars: job.config.maxDiffChars, maxFileChars: Math.min(job.config.maxDiffChars, 20_000) },
    notes,
  );
  if (snapshot.skippedLarge.length) diff.truncated = true;
  if (diff.files.length === 0) throw new NoChangesError();
  onStart?.(diff);

  const { builder } = job;
  const canFork = builder?.sessionId && builder.agent === job.reviewer && job.reviewer !== "gemini";
  const forkSession = canFork ? builder!.sessionId : null;
  const prompt = buildReviewPrompt({
    diff,
    forked: forkSession !== null,
    transcriptExcerpt: forkSession ? "" : await readTranscriptExcerpt(builder?.transcriptPath ?? null),
    lastAgentMessage: builder?.lastMessage ?? null,
    language: job.config.language,
    scope: job.scope,
  });
  const result = await runner({ agent: job.reviewer, cwd: job.cwd, prompt, config: job.config, forkSession });

  const report: Report = {
    version: 1,
    id: newReportId(),
    created_at: new Date().toISOString(),
    repo: job.repo,
    base: diff.base,
    head: job.reportHead,
    reviewer: { agent: job.reviewer, model: result.model, forked_from_session: result.forkedFrom },
    ...result.content,
    files_reviewed: diff.files.map((f) => f.path),
    truncated: diff.truncated,
  };
  const paths = await saveReport(job.repo, report);
  return { report, paths, diff };
}

/** Claude Code stores transcripts under ~/.claude/projects/<cwd with every non-alphanumeric char as "-">/<id>.jsonl */
export function claudeTranscriptPath(cwd: string, sessionId: string, claudeHome = join(homedir(), ".claude")): string {
  return join(claudeHome, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);
}

async function findCodexRollout(sessionId: string): Promise<string | null> {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
  const walk = async (dir: string, depth: number): Promise<string | null> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries.sort((a, b) => b.name.localeCompare(a.name))) {
      const full = join(dir, e.name);
      if (e.isDirectory() && depth < 3) {
        const hit = await walk(full, depth + 1);
        if (hit) return hit;
      } else if (e.isFile() && e.name.endsWith(`${sessionId}.jsonl`)) {
        return full;
      }
    }
    return null;
  };
  return walk(root, 0);
}

/** Work out which agent owns a session id given on the command line, and where its transcript is. */
export async function locateSession(sessionId: string, cwd: string): Promise<BuilderSession | null> {
  const claudePath = claudeTranscriptPath(cwd, sessionId);
  if (await stat(claudePath).then((s) => s.isFile()).catch(() => false)) {
    return { agent: "claude", sessionId, transcriptPath: claudePath, lastMessage: null };
  }
  const codexPath = await findCodexRollout(sessionId);
  if (codexPath) return { agent: "codex", sessionId, transcriptPath: codexPath, lastMessage: null };
  return null;
}
