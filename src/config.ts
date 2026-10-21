import { join } from "node:path";
import { intuitionDir, readJsonFile, userConfigDir, writeJsonFile } from "./paths.js";
import { AGENTS, type AgentId } from "./report/types.js";

export type ReviewerChoice = "same" | AgentId;

export interface Config {
  /** Master switch for the automatic review after each agent turn. */
  enabled: boolean;
  /** Who reviews: "same" = a fork of the agent that did the work; or a specific agent (cross-vendor). */
  reviewer: ReviewerChoice;
  /** Optional extra reviewer from another vendor, run in parallel after each turn. */
  secondOpinion: AgentId | "none";
  /** Language the review is written in. */
  language: string;
  /** Hard limit for one reviewer run. */
  timeoutSec: number;
  /** Max characters of diff handed to the reviewer before it is summarised. */
  maxDiffChars: number;
  claudeModel: string | null;
  codexModel: string | null;
  geminiModel: string | null;
  /** Passed to `claude --setting-sources` for reviewer runs, e.g. "project,local". null = Claude's default. */
  claudeSettingSources: string | null;
  /** Run Codex reviewers with `--ignore-user-config` (skip personal MCP servers, plugins and model overrides). */
  codexIgnoreUserConfig: boolean;
  /** Ask the coding agent to relay the review in chat after each turn. */
  presentInChat: boolean;
  /** Open the HTML report in the browser after each automatic review. */
  openReport: boolean;
}

export const DEFAULT_CONFIG: Config = {
  enabled: true,
  reviewer: "same",
  secondOpinion: "none",
  language: "English",
  timeoutSec: 300,
  maxDiffChars: 120_000,
  claudeModel: null,
  codexModel: null,
  geminiModel: null,
  claudeSettingSources: null,
  codexIgnoreUserConfig: false,
  presentInChat: true,
  openReport: false,
};

export const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof Config)[];

export const userConfigPath = () => join(userConfigDir(), "config.json");
export const projectConfigPath = (repo: string) => join(intuitionDir(repo), "config.json");

export class ConfigError extends Error {}

/** Parse and validate one value for `key`. Throws ConfigError with a plain-English message. */
export function parseConfigValue(key: string, raw: unknown): Config[keyof Config] {
  if (!(CONFIG_KEYS as string[]).includes(key)) {
    throw new ConfigError(`Unknown setting "${key}". Known settings: ${CONFIG_KEYS.join(", ")}.`);
  }
  const k = key as keyof Config;
  const def = DEFAULT_CONFIG[k];
  const str = typeof raw === "string" ? raw.trim() : raw;
  if (typeof def === "boolean") {
    if (typeof str === "boolean") return str;
    if (str === "true" || str === "on" || str === "1" || str === "yes") return true;
    if (str === "false" || str === "off" || str === "0" || str === "no") return false;
    throw new ConfigError(`"${key}" must be true or false.`);
  }
  if (typeof def === "number") {
    const n = typeof str === "number" ? str : Number(str);
    if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`"${key}" must be a positive number.`);
    return Math.round(n);
  }
  if (k === "reviewer") {
    if (str === "same" || AGENTS.includes(str as AgentId)) return str as ReviewerChoice;
    throw new ConfigError(`"reviewer" must be one of: same, ${AGENTS.join(", ")}.`);
  }
  if (k === "secondOpinion") {
    if (str === "none" || AGENTS.includes(str as AgentId)) return str as AgentId | "none";
    throw new ConfigError(`"secondOpinion" must be one of: none, ${AGENTS.join(", ")}.`);
  }
  if (str === null || str === "null" || str === "") {
    if (k === "language") throw new ConfigError(`"language" can't be empty.`);
    return null;
  }
  if (typeof str !== "string") throw new ConfigError(`"${key}" must be text.`);
  return str;
}

function applyLayer(target: Config, layer: Record<string, unknown> | null, source: string): void {
  if (!layer) return;
  for (const [key, value] of Object.entries(layer)) {
    try {
      Object.assign(target, { [key]: parseConfigValue(key, value) });
    } catch (err) {
      throw new ConfigError(`${source}: ${(err as Error).message}`);
    }
  }
}

const ENV_OVERRIDES: Record<string, keyof Config> = {
  INTUITION_TIMEOUT_SEC: "timeoutSec",
  INTUITION_CLAUDE_MODEL: "claudeModel",
  INTUITION_CODEX_MODEL: "codexModel",
  INTUITION_GEMINI_MODEL: "geminiModel",
  INTUITION_CLAUDE_SETTING_SOURCES: "claudeSettingSources",
  INTUITION_CODEX_IGNORE_USER_CONFIG: "codexIgnoreUserConfig",
  INTUITION_REVIEWER: "reviewer",
  INTUITION_LANGUAGE: "language",
};

/** Defaults < user config < project config (`.intuition/config.json`) < INTUITION_* environment variables. */
export async function loadConfig(repo: string | null): Promise<Config> {
  const config: Config = { ...DEFAULT_CONFIG };
  applyLayer(config, await readJsonFile(userConfigPath()), userConfigPath());
  if (repo) applyLayer(config, await readJsonFile(projectConfigPath(repo)), projectConfigPath(repo));
  for (const [name, key] of Object.entries(ENV_OVERRIDES)) {
    const value = process.env[name];
    if (value !== undefined && value !== "") applyLayer(config, { [key]: value }, `environment variable ${name}`);
  }
  if (process.env.INTUITION_DISABLED === "1") config.enabled = false;
  return config;
}

export async function setConfigValue(path: string, key: string, raw: string): Promise<Config[keyof Config]> {
  const value = parseConfigValue(key, raw);
  const current = (await readJsonFile<Record<string, unknown>>(path)) ?? {};
  current[key] = value;
  await writeJsonFile(path, current);
  return value;
}

export async function unsetConfigValue(path: string, key: string): Promise<boolean> {
  const current = await readJsonFile<Record<string, unknown>>(path);
  if (!current || !(key in current)) return false;
  delete current[key];
  await writeJsonFile(path, current);
  return true;
}
