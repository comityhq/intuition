import { join } from "node:path";
import { intuitionDir, readJsonFile, writeJsonFile } from "./paths.js";
import type { AgentId } from "./report/types.js";

export interface SessionState {
  agent: AgentId;
  transcriptPath: string | null;
  /** Directory the agent session runs in (needed to fork a Claude Code session). */
  cwd: string | null;
  /** Working-tree snapshot (git tree id) taken when the user sent the current prompt. */
  turnBase: string | null;
  /** Base of the most recently reviewed turn: `review --since last-turn` reviews from here. */
  lastTurnBase: string | null;
  /** Snapshot that was last reviewed (or deliberately skipped) for this session. */
  lastReviewed: string | null;
  updatedAt: string;
}

export interface State {
  version: 1;
  sessions: Record<string, SessionState>;
  lastSessionId: string | null;
}

const MAX_SESSIONS = 50;

export const statePath = (repo: string) => join(intuitionDir(repo), "state.json");

export async function loadState(repo: string): Promise<State> {
  try {
    const state = await readJsonFile<State>(statePath(repo));
    if (state?.version === 1 && state.sessions) return state;
  } catch {
    // Corrupt state is not worth failing a review over: start fresh.
  }
  return { version: 1, sessions: {}, lastSessionId: null };
}

export async function saveState(repo: string, state: State): Promise<void> {
  const ids = Object.keys(state.sessions);
  if (ids.length > MAX_SESSIONS) {
    ids
      .sort((a, b) => state.sessions[a]!.updatedAt.localeCompare(state.sessions[b]!.updatedAt))
      .slice(0, ids.length - MAX_SESSIONS)
      .forEach((id) => delete state.sessions[id]);
  }
  await writeJsonFile(statePath(repo), state);
}

export function touchSession(
  state: State,
  sessionId: string,
  agent: AgentId,
  transcriptPath: string | null,
  cwd: string | null,
): SessionState {
  const session: SessionState = state.sessions[sessionId] ?? {
    agent,
    transcriptPath,
    cwd,
    turnBase: null,
    lastTurnBase: null,
    lastReviewed: null,
    updatedAt: "",
  };
  session.agent = agent;
  session.transcriptPath = transcriptPath ?? session.transcriptPath;
  session.cwd = cwd ?? session.cwd ?? null;
  session.lastTurnBase ??= null;
  session.updatedAt = new Date().toISOString();
  state.sessions[sessionId] = session;
  state.lastSessionId = sessionId;
  return session;
}
