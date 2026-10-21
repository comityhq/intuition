import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { loadConfig, DEFAULT_CONFIG, type Config } from "./config.js";
import { findRepoRoot, git } from "./git.js";
import { isOurs, settingsFile, type HookAgent, type Scope } from "./install.js";
import { intuitionDir, readJsonFile } from "./paths.js";
import { run } from "./proc.js";
import { agentBinary } from "./reviewers.js";

export type CheckStatus = "ok" | "warn" | "fail" | "info";

export interface Check {
  status: CheckStatus;
  label: string;
  detail: string;
}

async function version(bin: string, args: string[] = ["--version"]): Promise<string | null> {
  const res = await run(bin, args, { cwd: process.cwd(), timeoutMs: 20_000 });
  return res.code === 0 ? (res.stdout || res.stderr).trim().split(/\r?\n/)[0] ?? "" : null;
}

async function helpMentions(bin: string, args: string[], needle: string): Promise<boolean> {
  const res = await run(bin, args, { cwd: process.cwd(), timeoutMs: 20_000 });
  return `${res.stdout}${res.stderr}`.includes(needle);
}

/** Our hook commands as found in a settings file, with the script path they point at. */
async function installedHooks(agent: HookAgent, scope: Scope, repo: string | null): Promise<{ file: string; commands: string[] } | null> {
  let file: string;
  try {
    file = settingsFile(agent, scope, repo);
  } catch {
    return null;
  }
  const settings = await readJsonFile<unknown>(file).catch(() => null);
  if (!settings || typeof settings !== "object" || !("hooks" in settings)) return null;
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return null;
  const commands: string[] = [];
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const handlers: unknown = group && typeof group === "object" && "hooks" in group ? group.hooks : null;
      if (!Array.isArray(handlers)) continue;
      for (const h of handlers) if (h && typeof h === "object" && isOurs(h) && typeof h.command === "string") commands.push(h.command);
    }
  }
  return commands.length ? { file, commands } : null;
}

export async function runDoctor(cwd: string): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (status: CheckStatus, label: string, detail: string) => checks.push({ status, label, detail });

  const major = Number(process.versions.node.split(".")[0]);
  add(major >= 22 ? "ok" : "fail", "Node.js", major >= 22 ? `v${process.versions.node}` : `v${process.versions.node}: version 22 or newer is required`);

  const gitVersion = await git(["--version"], { cwd, allowFail: true });
  add(gitVersion ? "ok" : "fail", "git", gitVersion.trim() || "not found: install git from https://git-scm.com");
  const repo = gitVersion ? await findRepoRoot(cwd) : null;
  add(repo ? "ok" : "warn", "Project", repo ?? "this folder isn't a git repository, so there is nothing to review here");

  let config: Config = DEFAULT_CONFIG;
  try {
    config = await loadConfig(repo);
    const changed = (Object.keys(config) as (keyof Config)[]).filter((k) => config[k] !== DEFAULT_CONFIG[k]);
    add("ok", "Settings", changed.length ? changed.map((k) => `${k}=${JSON.stringify(config[k])}`).join(", ") : "defaults");
  } catch (err) {
    add("fail", "Settings", (err as Error).message);
  }
  if (!config.enabled) add("warn", "Automatic reviews", "turned off (comity-intuition config set enabled true)");

  const claude = agentBinary("claude");
  if (claude) {
    const v = await version(claude);
    const fork = await helpMentions(claude, ["--help"], "--fork-session");
    add(v && fork ? "ok" : "warn", "Claude Code", `${v ?? "installed, but it didn't report a version"}${fork ? "; can fork sessions" : "; this version can't fork sessions, so reviews use the conversation transcript instead (update with: claude update)"}`);
  } else {
    add("warn", "Claude Code", "not found on PATH (https://claude.com/claude-code)");
  }
  const codex = agentBinary("codex");
  if (codex) {
    const v = await version(codex);
    const fork = await helpMentions(codex, ["exec", "--help"], "fork");
    add(v ? "ok" : "warn", "Codex", `${v ?? "installed"}${fork ? "; can fork sessions" : "; no 'codex exec fork', reviews of Codex work use the transcript"}`);
  } else {
    add("info", "Codex", "not installed (optional: second opinions and reviewing Codex work)");
  }
  const gemini = agentBinary("gemini");
  add(gemini ? "ok" : "info", "Gemini CLI", gemini ? ((await version(gemini)) ?? "installed") : "not installed (optional reviewer)");

  for (const agent of ["claude", "codex"] as const) {
    for (const scope of ["project", "user"] as const) {
      const found = await installedHooks(agent, scope, repo);
      if (!found) continue;
      const scripts = found.commands.map((c) => /^node "([^"]+)"/.exec(c)?.[1]).filter((p): p is string => Boolean(p));
      const missing: string[] = [];
      for (const s of new Set(scripts)) if (!(await access(s).then(() => true, () => false))) missing.push(s);
      add(
        missing.length ? "fail" : "ok",
        `${agent === "claude" ? "Claude Code" : "Codex"} hooks (${scope})`,
        missing.length ? `${found.file} points at a missing file ${missing.join(", ")}: run comity-intuition init again` : found.file,
      );
    }
  }
  if (!checks.some((c) => c.label.includes("hooks ("))) {
    add("warn", "Hooks", "not installed: run comity-intuition init (manual reviews with comity-intuition review still work)");
  }
  if (config.reviewer !== "same" && !agentBinary(config.reviewer)) {
    add("fail", "Reviewer", `reviewer is set to ${config.reviewer}, but it isn't installed`);
  }
  if (config.secondOpinion !== "none" && !agentBinary(config.secondOpinion)) {
    add("warn", "Second opinion", `${config.secondOpinion} isn't installed, so the second opinion will be skipped`);
  }

  if (repo) {
    // Check without creating anything: the folder if it exists, else the project folder it will be created in.
    const target = (await access(intuitionDir(repo)).then(() => true, () => false)) ? intuitionDir(repo) : repo;
    try {
      await access(target, constants.W_OK);
      add("ok", "Report folder", join(intuitionDir(repo), "reports"));
    } catch (err) {
      add("fail", "Report folder", `can't write to ${target}: ${(err as Error).message}`);
    }
    const log = await readFile(join(intuitionDir(repo), "hook.log"), "utf8").catch(() => "");
    const problems = log.split(/\r?\n/).filter((l) => /failed|error/i.test(l)).slice(-3);
    if (problems.length) add("warn", "Recent hook problems", problems.join("\n             "));
  }
  return checks;
}

export function formatChecks(checks: Check[]): string {
  const tag: Record<CheckStatus, string> = { ok: "[ok]  ", warn: "[warn]", fail: "[FAIL]", info: "[info]" };
  return checks.map((c) => `${tag[c.status]} ${c.label}: ${c.detail}`).join("\n");
}
