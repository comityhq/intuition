import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The one spelling of a path we compare and relativize with: symlinks/junctions resolved (macOS
 * `/var` -> `/private/var`), Windows 8.3 short names expanded (`RUNNER~1` -> `runneradmin`), and
 * forward slashes on Windows to match what git prints. A path that doesn't exist is returned as given.
 */
export function canonicalPath(path: string): string {
  let real: string;
  try {
    real = realpathSync.native(path);
  } catch {
    return path;
  }
  return process.platform === "win32" ? real.replace(/\\/g, "/") : real;
}

export const INTUITION_DIR = ".intuition";

export const intuitionDir = (repo: string) => join(repo, INTUITION_DIR);
export const reportsDir = (repo: string) => join(repo, INTUITION_DIR, "reports");

/** Create `<repo>/.intuition/` with a `.gitignore` of `*` so nothing in it is ever committed. */
export async function ensureIntuitionDir(repo: string): Promise<string> {
  const dir = intuitionDir(repo);
  await mkdir(join(dir, "reports"), { recursive: true });
  await writeFile(join(dir, ".gitignore"), "# Created by Comity Intuition: keep local reviews out of git.\n*\n", {
    flag: "wx",
  }).catch(() => undefined);
  return dir;
}

/** Per-user config folder. INTUITION_HOME overrides it (tests, portable installs). */
export function userConfigDir(): string {
  if (process.env.INTUITION_HOME) return canonicalPath(process.env.INTUITION_HOME);
  // The base folder always exists; our own subfolder may not yet, so canonicalize the base.
  if (process.platform === "win32") {
    return join(canonicalPath(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")), "comity-intuition");
  }
  if (process.platform === "darwin") return join(canonicalPath(homedir()), "Library", "Application Support", "comity-intuition");
  return join(canonicalPath(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")), "comity-intuition");
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
}

/** Write JSON atomically (temp file + rename) so a crash never leaves half a settings file behind. */
export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}
