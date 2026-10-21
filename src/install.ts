import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile, writeJsonFile } from "./paths.js";

export type Scope = "project" | "user";
export type HookAgent = "claude" | "codex";

/** Every hook we install carries this statusMessage prefix; it is how init/uninstall recognise our entries. */
export const HOOK_MARKER = "Comity Intuition";

interface HookHandler {
  type: string;
  command?: string;
  args?: string[];
  timeout?: number;
  statusMessage?: string;
  [key: string]: unknown;
}

interface MatcherGroup {
  matcher?: string;
  hooks?: HookHandler[];
  [key: string]: unknown;
}

type HooksMap = Record<string, MatcherGroup[]>;

export interface InstallChange {
  agent: HookAgent;
  file: string;
  action: "created" | "updated" | "unchanged" | "removed" | "not-found";
  note?: string;
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function packageVersion(): string {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    if (pkg && typeof pkg === "object" && "version" in pkg && typeof pkg.version === "string") return pkg.version;
  } catch {
    // fall through
  }
  return "0.0.0";
}

/**
 * Command line a hook uses to call us. Normally `node "<this install>/dist/cli.js"` (fast, no PATH lookup);
 * when running from a temporary npx cache, a versioned `npx` call instead, because the cache can be wiped.
 */
export function selfCommand(): string {
  const cli = join(PACKAGE_ROOT, "dist", "cli.js").replace(/\\/g, "/");
  if (/[\\/]_npx[\\/]/.test(cli)) return `npx -y comity-intuition@${packageVersion()}`;
  return `node "${cli}"`;
}

export function isOurs(handler: object): boolean {
  const status = "statusMessage" in handler ? handler.statusMessage : undefined;
  const command = "command" in handler ? handler.command : undefined;
  return (
    (typeof status === "string" && status.startsWith(HOOK_MARKER)) ||
    (typeof command === "string" && /comity-intuition|intuition(\.js)?"? hook (stop|prompt)/.test(command))
  );
}

/** Remove our handlers from a hooks map (dropping groups and events that end up empty). Returns a new map. */
export function withoutOurHooks(hooks: HooksMap): HooksMap {
  const out: HooksMap = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept: MatcherGroup[] = [];
    for (const group of groups ?? []) {
      const handlers = (group.hooks ?? []).filter((h) => !isOurs(h));
      if (handlers.length > 0) kept.push({ ...group, hooks: handlers });
      else if (!(group.hooks ?? []).some(isOurs)) kept.push(group);
    }
    if (kept.length > 0) out[event] = kept;
  }
  return out;
}

export function ourHooks(agent: HookAgent, command = selfCommand()): HooksMap {
  return {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: `${command} hook prompt --agent ${agent}`,
            timeout: 60,
            statusMessage: `${HOOK_MARKER}: noting where this turn starts`,
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: `${command} hook stop --agent ${agent}`,
            timeout: 900,
            statusMessage: `${HOOK_MARKER}: reviewing the changes in plain English`,
          },
        ],
      },
    ],
  };
}

export function mergeHooks(existing: HooksMap | undefined, ours: HooksMap): HooksMap {
  const merged = withoutOurHooks(existing ?? {});
  for (const [event, groups] of Object.entries(ours)) merged[event] = [...(merged[event] ?? []), ...groups];
  return merged;
}

export function settingsFile(agent: HookAgent, scope: Scope, repo: string | null): string {
  if (scope === "project") {
    if (!repo) throw new Error("Project scope needs a git repository. Run this inside your project, or use --scope user.");
    return agent === "claude" ? join(repo, ".claude", "settings.json") : join(repo, ".codex", "hooks.json");
  }
  return agent === "claude"
    ? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json")
    : join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "hooks.json");
}

async function readSettings(file: string): Promise<Record<string, unknown> | null> {
  let value: unknown;
  try {
    value = await readJsonFile<unknown>(file);
  } catch {
    throw new Error(`${file} isn't valid JSON, so it wasn't changed. Fix or remove it, then run init again.`);
  }
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${file} doesn't contain a JSON object, so it wasn't changed. Fix or remove it, then run init again.`);
  }
  return { ...value };
}

/** The "hooks" key of a settings file, checked to be { event: [group, ...] }. Anything else is refused, not overwritten. */
function hooksOf(settings: Record<string, unknown> | null, file: string): HooksMap {
  const hooks = settings?.hooks;
  if (hooks === undefined) return {};
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks) || !Object.values(hooks).every(Array.isArray)) {
    throw new Error(`The "hooks" section of ${file} has an unexpected shape, so it wasn't changed.`);
  }
  // Shape checked above: an object whose values are arrays of matcher groups.
  const map: HooksMap = { ...hooks };
  return map;
}

export async function installHooks(agent: HookAgent, file: string, dryRun: boolean, command?: string): Promise<InstallChange> {
  const current = await readSettings(file);
  const next: Record<string, unknown> = { ...(current ?? {}), hooks: mergeHooks(hooksOf(current, file), ourHooks(agent, command)) };
  const unchanged = current !== null && JSON.stringify(current) === JSON.stringify(next);
  if (!unchanged && !dryRun) await writeJsonFile(file, next);
  const note =
    agent === "codex"
      ? "Codex only runs project hooks it trusts: open Codex in this folder and approve them with /hooks (automation can pass --dangerously-bypass-hook-trust)."
      : undefined;
  return { agent, file, action: unchanged ? "unchanged" : current === null ? "created" : "updated", note };
}

export async function uninstallHooks(agent: HookAgent, file: string, dryRun: boolean): Promise<InstallChange> {
  const current = await readSettings(file);
  const hooks = hooksOf(current, file);
  if (!current || !Object.values(hooks).some((groups) => groups.some((g) => (g.hooks ?? []).some(isOurs)))) {
    return { agent, file, action: "not-found" };
  }
  const remaining = withoutOurHooks(hooks);
  const next: Record<string, unknown> = { ...current, hooks: remaining };
  if (Object.keys(remaining).length === 0) delete next.hooks;
  if (!dryRun) {
    // A Codex hooks.json that only held our hooks is ours to delete; Claude settings files are always kept.
    if (agent === "codex" && Object.keys(next).filter((k) => k !== "description").length === 0) await rm(file, { force: true });
    else await writeJsonFile(file, next);
  }
  return { agent, file, action: "removed" };
}
