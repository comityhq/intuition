#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import {
  CONFIG_KEYS,
  ConfigError,
  loadConfig,
  projectConfigPath,
  setConfigValue,
  unsetConfigValue,
  userConfigPath,
  type Config,
} from "./config.js";
import { formatChecks, runDoctor } from "./doctor.js";
import { findRepoRoot, resolveTreeish } from "./git.js";
import { handleHook, parseHookInput, type HookEvent } from "./hook.js";
import { installHooks, packageVersion, settingsFile, uninstallHooks, type HookAgent, type InstallChange, type Scope } from "./install.js";
import { openInBrowser } from "./open.js";
import { ensureIntuitionDir, intuitionDir } from "./paths.js";
import { reviewDigest } from "./present.js";
import { AGENT_NAME, VERDICT_LABEL } from "./report/render.js";
import { loadReport, reportPaths } from "./report/store.js";
import { AGENTS, type AgentId, type Report } from "./report/types.js";
import { NoChangesError, locateSession, resolveReviewer, runReview, type BuilderSession } from "./review.js";
import { agentBinary } from "./reviewers.js";
import { loadState } from "./state.js";

class UsageError extends Error {}

const HELP = `Comity Intuition ${packageVersion()}: your AI's gut check before you ship.

After your coding agent finishes a task, a forked copy of that same session reviews the
changes with fresh eyes and explains them in plain English: what changed, business risks,
a verdict, and questions to ask a developer. Runs locally with your own agent subscription.

Usage: comity-intuition <command> [options]        (alias: intuition)

  init        Install the automatic review hooks
                --agent claude|codex|all   (default: claude)
                --scope project|user       (default: project)
                --dry-run                  show what would change
  review      Review the current changes now
                --repo <path>              project folder (default: current folder)
                --since <ref>              compare with a branch/commit, or "last-turn"
                --reviewer same|claude|codex|gemini
                --session <id>|last        give the reviewer that agent session's context
                --json                     print the report as JSON only
                --open                     open the HTML report
  report      Show a saved report: report [--last | <id>] [--open] [--json]
  doctor      Check your setup
  uninstall   Remove the hooks: [--agent claude|codex|all] [--scope project|user] [--purge] [--dry-run]
  config      config get [key] | config set <key> <value> | config unset <key>   [--user]

Reports are saved in <project>/.intuition/reports/ (git-ignored). Nothing is sent to Comity.
Reviewed by Comity Intuition · free & open source · comity.so`;

type FlagSpec = Record<string, { type: "string" | "boolean"; short?: string }>;

function parse<const O extends FlagSpec>(argv: string[], options: O) {
  const config = { args: argv, options: { ...options, help: { type: "boolean", short: "h" } }, allowPositionals: true, strict: true } as const;
  try {
    return parseArgs(config);
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

function oneOfFlag<T extends string>(value: unknown, allowed: readonly T[], flag: string, fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new UsageError(`${flag} must be one of: ${allowed.join(", ")}`);
}

async function requireRepo(path: string | undefined): Promise<string> {
  const repo = await findRepoRoot(path ?? process.cwd());
  if (!repo) throw new UsageError(`${path ?? "This folder"} isn't inside a git repository. Run this in your project folder (or pass --repo).`);
  return repo;
}

function describeChange(c: InstallChange, cwd: string, dryRun: boolean): string {
  const file = relative(cwd, c.file).startsWith("..") ? c.file : relative(cwd, c.file) || c.file;
  const verb = dryRun
    ? { created: "Would create", updated: "Would update", unchanged: "Already up to date:", removed: "Would remove hooks from", "not-found": "No hooks found in" }
    : { created: "Created", updated: "Updated", unchanged: "Already up to date:", removed: "Removed hooks from", "not-found": "No hooks found in" };
  return `${verb[c.action]} ${file}${c.note ? `\n  Note: ${c.note}` : ""}`;
}

async function cmdInit(argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    agent: { type: "string" },
    scope: { type: "string" },
    repo: { type: "string" },
    "dry-run": { type: "boolean" },
  });
  if (values.help) return printHelp();
  const agentFlag = oneOfFlag(values.agent, ["claude", "codex", "all"] as const, "--agent", "claude");
  const scope = oneOfFlag(values.scope, ["project", "user"] as const, "--scope", "project");
  const dryRun = Boolean(values["dry-run"]);
  const repo = scope === "project" ? await requireRepo(values.repo) : await findRepoRoot(process.cwd());
  const agents: HookAgent[] = agentFlag === "all" ? ["claude", "codex"] : [agentFlag];
  const lines: string[] = [dryRun ? "Dry run: nothing was changed. Would do:" : "Comity Intuition is set up:"];
  for (const agent of agents) {
    if (agentFlag === "all" && !agentBinary(agent)) {
      lines.push(`Skipped ${AGENT_NAME[agent]}: not installed.`);
      continue;
    }
    lines.push(describeChange(await installHooks(agent, settingsFile(agent, scope, repo), dryRun), process.cwd(), dryRun));
  }
  if (repo) {
    if (!dryRun) await ensureIntuitionDir(repo);
    lines.push(`${dryRun ? "Would create" : "Reports folder:"} ${join(relative(process.cwd(), intuitionDir(repo)) || ".", "reports")} (git-ignored via .intuition/.gitignore)`);
  }
  if (!dryRun) {
    lines.push(
      "",
      "What happens now: each time your agent finishes a turn that changed code, a read-only copy of that",
      "session reviews the changes and the agent shows you a plain-English verdict in the chat.",
      "Try it without waiting: comity-intuition review --open",
    );
  }
  console.log(lines.join("\n"));
  return 0;
}

async function cmdUninstall(argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    agent: { type: "string" },
    scope: { type: "string" },
    repo: { type: "string" },
    purge: { type: "boolean" },
    "dry-run": { type: "boolean" },
  });
  if (values.help) return printHelp();
  const agentFlag = oneOfFlag(values.agent, ["claude", "codex", "all"] as const, "--agent", "all");
  const scope = oneOfFlag(values.scope, ["project", "user"] as const, "--scope", "project");
  const dryRun = Boolean(values["dry-run"]);
  const repo = scope === "project" ? await requireRepo(values.repo) : await findRepoRoot(process.cwd());
  const agents: HookAgent[] = agentFlag === "all" ? ["claude", "codex"] : [agentFlag];
  const lines: string[] = dryRun ? ["Dry run: nothing was changed."] : [];
  for (const agent of agents) lines.push(describeChange(await uninstallHooks(agent, settingsFile(agent, scope, repo), dryRun), process.cwd(), dryRun));
  if (values.purge && repo) {
    if (!dryRun) await rm(intuitionDir(repo), { recursive: true, force: true });
    lines.push(`${dryRun ? "Would delete" : "Deleted"} ${intuitionDir(repo)} (saved reports and settings)`);
  }
  console.log(lines.join("\n"));
  return 0;
}

async function builderFromFlag(session: string, repo: string): Promise<{ builder: BuilderSession; cwd: string; lastTurnBase: string | null }> {
  const state = await loadState(repo);
  const id = session === "last" ? state.lastSessionId : session;
  if (!id) throw new UsageError("No agent session has been recorded in this project yet. Pass a session id, or run without --session.");
  const known = state.sessions[id];
  if (known) {
    return {
      builder: { agent: known.agent, sessionId: id, transcriptPath: known.transcriptPath, lastMessage: null },
      cwd: known.cwd ?? repo,
      lastTurnBase: known.lastTurnBase,
    };
  }
  const located = (await locateSession(id, process.cwd())) ?? (await locateSession(id, repo));
  if (!located) throw new UsageError(`Couldn't find a Claude Code or Codex session with id ${id}.`);
  return { builder: located, cwd: repo, lastTurnBase: null };
}

function printSummary(report: Report, html: string): void {
  const lines = [
    "",
    `${report.verdict.toUpperCase()} · ${VERDICT_LABEL[report.verdict]}`,
    report.headline,
    "",
    reviewDigest(report).split("\n").slice(2).join("\n"),
    "",
    `Reviewer: ${AGENT_NAME[report.reviewer.agent]}${report.reviewer.model ? ` (${report.reviewer.model})` : ""}${report.reviewer.forked_from_session ? `, forked from session ${report.reviewer.forked_from_session}` : ""}`,
    `Report: ${html}`,
    "",
    "Reviewed by Comity Intuition · free & open source · comity.so",
  ];
  console.log(lines.join("\n"));
}

async function cmdReview(argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    repo: { type: "string" },
    since: { type: "string" },
    reviewer: { type: "string" },
    session: { type: "string" },
    json: { type: "boolean" },
    open: { type: "boolean" },
  });
  if (values.help) return printHelp();
  const repo = await requireRepo(values.repo);
  const config: Config = { ...(await loadConfig(repo)) };
  config.reviewer = oneOfFlag(values.reviewer, ["same", ...AGENTS] as const, "--reviewer", config.reviewer);

  let builder: BuilderSession | null = null;
  let cwd = repo;
  let lastTurnBase: string | null = null;
  if (typeof values.session === "string") ({ builder, cwd, lastTurnBase } = await builderFromFlag(values.session, repo));

  const since = values.since;
  let base: string;
  let scope: string;
  if (since === "last-turn") {
    if (!lastTurnBase) {
      const state = await loadState(repo);
      lastTurnBase = state.lastSessionId ? (state.sessions[state.lastSessionId]?.lastTurnBase ?? null) : null;
    }
    if (!lastTurnBase) throw new UsageError("No reviewed agent turn is recorded in this project yet, so there is no \"last turn\" to compare with.");
    base = lastTurnBase;
    scope = "everything changed since the start of the coding agent's last turn";
  } else {
    base = await resolveTreeish(repo, since ?? "HEAD");
    scope = since ? `all changes since ${since}, including uncommitted ones` : "all uncommitted changes (compared with the last commit)";
  }

  const reviewer: AgentId = resolveReviewer(config.reviewer, builder);
  const forking = Boolean(builder?.sessionId && builder.agent === reviewer && reviewer !== "gemini");
  const how = forking
    ? `a forked copy of session ${builder!.sessionId}`
    : builder
      ? "a fresh read-only session, given the builder's conversation"
      : "a fresh read-only session";
  const outcome = await runReview({ repo, cwd, base, reportHead: null, reviewer, builder, config, scope }, undefined, (diff) =>
    console.error(
      `Comity Intuition: reviewing ${diff.files.length} changed file${diff.files.length === 1 ? "" : "s"} with ${AGENT_NAME[reviewer]} (${how}). This usually takes under 2 minutes…`,
    ),
  );
  if (values.json) console.log(JSON.stringify(outcome.report, null, 2));
  else printSummary(outcome.report, outcome.paths.html);
  if (values.open) openInBrowser(outcome.paths.html);
  return 0;
}

async function cmdReport(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, {
    last: { type: "boolean" },
    open: { type: "boolean" },
    json: { type: "boolean" },
    repo: { type: "string" },
  });
  if (values.help) return printHelp();
  const repo = await requireRepo(values.repo);
  const id = values.last ? null : (positionals[0] ?? null);
  const report = await loadReport(repo, id);
  if (!report) {
    console.error(id ? `No report matching "${id}" in ${repo}.` : `No reports yet in ${repo}. Run: comity-intuition review`);
    return 1;
  }
  const html = reportPaths(repo, report.id).html;
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else printSummary(report, html);
  if (values.open) openInBrowser(html);
  return 0;
}

async function cmdDoctor(argv: string[]): Promise<number> {
  const { values } = parse(argv, { repo: { type: "string" } });
  if (values.help) return printHelp();
  const checks = await runDoctor(values.repo ?? process.cwd());
  console.log(`Comity Intuition ${packageVersion()} doctor\n\n${formatChecks(checks)}`);
  return checks.some((c) => c.status === "fail") ? 1 : 0;
}

async function cmdConfig(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, { user: { type: "boolean" }, repo: { type: "string" } });
  if (values.help) return printHelp();
  const [action, key, ...rest] = positionals;
  const repo = await findRepoRoot(values.repo ?? process.cwd());
  const target = values.user || !repo ? userConfigPath() : projectConfigPath(repo);
  if (action === "get" || action === undefined) {
    const config = await loadConfig(repo);
    if (key) {
      if (!(CONFIG_KEYS as string[]).includes(key)) throw new ConfigError(`Unknown setting "${key}". Known settings: ${CONFIG_KEYS.join(", ")}.`);
      console.log(JSON.stringify(config[key as keyof Config]));
    } else {
      console.log(JSON.stringify(config, null, 2));
    }
    return 0;
  }
  if (action === "set") {
    if (!key || rest.length === 0) throw new UsageError("Usage: comity-intuition config set <key> <value> [--user]");
    if (!values.user && repo) await ensureIntuitionDir(repo);
    const value = await setConfigValue(target, key, rest.join(" "));
    console.log(`Set ${key} = ${JSON.stringify(value)} in ${target}`);
    return 0;
  }
  if (action === "unset") {
    if (!key) throw new UsageError("Usage: comity-intuition config unset <key> [--user]");
    console.log((await unsetConfigValue(target, key)) ? `Removed ${key} from ${target}` : `${key} wasn't set in ${target}`);
    return 0;
  }
  if (action === "path") {
    console.log(`user:    ${userConfigPath()}${repo ? `\nproject: ${projectConfigPath(repo)}` : ""}`);
    return 0;
  }
  throw new UsageError(`Unknown config action "${action}". Use get, set, unset or path.`);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function cmdHook(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, { agent: { type: "string" } });
  const event = oneOfFlag<HookEvent>(positionals[0], ["prompt", "stop"], "hook event", "stop");
  const agent = oneOfFlag(values.agent, ["claude", "codex"] as const, "--agent", "claude");
  const result = await handleHook(event, agent, parseHookInput(await readStdin()));
  if (result.output) process.stdout.write(`${JSON.stringify(result.output)}\n`);
  if (process.env.INTUITION_DEBUG === "1") console.error(`[intuition] hook ${event}: ${result.skipped ?? "ran"}`);
  return 0;
}

function printHelp(): number {
  console.log(HELP);
  return 0;
}

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  init: cmdInit,
  review: cmdReview,
  report: cmdReport,
  doctor: cmdDoctor,
  uninstall: cmdUninstall,
  config: cmdConfig,
  hook: cmdHook,
};

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") return printHelp();
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(packageVersion());
    return 0;
  }
  const handler = COMMANDS[command];
  if (!handler) throw new UsageError(`Unknown command "${command}". Run comity-intuition --help.`);
  return handler(rest);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof NoChangesError) {
      console.error(`Comity Intuition: ${err.message}`);
      process.exitCode = 2;
      return;
    }
    console.error(`Comity Intuition: ${err instanceof Error ? err.message : String(err)}`);
    if (process.env.INTUITION_DEBUG === "1" && err instanceof Error) console.error(err.stack);
    process.exitCode = 1;
  },
);
