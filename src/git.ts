import { execFile } from "node:child_process";
import { copyFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** git's well-known empty tree: the base for repositories without any commit yet. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Untracked files bigger than this are listed but never hashed into git objects. */
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;

/** Paths Intuition never reviews: its own folder. */
const OWN_PATHSPEC = ":(exclude).intuition";

const NOISY_FILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum|flake\.lock)$|\.min\.(js|css)$|\.map$/i;

export class GitError extends Error {}

interface GitOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  allowFail?: boolean;
}

export function git(args: string[], opts: GitOptions): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const child = execFile(
    "git",
    ["-c", "core.quotepath=off", "-c", "color.ui=false", ...args],
    {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", ...opts.env },
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
      encoding: "utf8",
    },
    (error, stdout, stderr) => {
      if (error && !opts.allowFail) reject(new GitError(`git ${args[0]} failed: ${(stderr || error.message).trim()}`));
      else resolve(error ? "" : stdout);
    },
  );
  if (opts.input !== undefined) child.stdin?.end(opts.input);
  return promise;
}

/** Absolute repo root (forward slashes on every OS), or null when `dir` is not inside a git work tree. */
export async function findRepoRoot(dir: string): Promise<string | null> {
  const out = await git(["rev-parse", "--show-toplevel"], { cwd: dir, allowFail: true });
  return out.trim() || null;
}

/** Resolve a ref to a commit or tree id. "HEAD" in a repo without commits resolves to the empty tree. */
export async function resolveTreeish(repo: string, ref: string): Promise<string> {
  for (const suffix of ["^{commit}", "^{tree}"]) {
    const out = await git(["rev-parse", "--verify", "--quiet", `${ref}${suffix}`], { cwd: repo, allowFail: true });
    if (out.trim()) return out.trim();
  }
  if (ref === "HEAD") return EMPTY_TREE;
  throw new GitError(`Can't find "${ref}" in this repository. Use a branch name, tag or commit id.`);
}

export interface Snapshot {
  /** git tree id of the whole working tree (tracked + untracked, minus ignored files). */
  tree: string;
  /** Untracked files too large to include; reported to the reviewer by name only. */
  skippedLarge: string[];
}

/**
 * Snapshot the working tree as a git tree object without touching the user's index, refs or files.
 * Uses a throwaway index seeded from the real one so unchanged files are not re-hashed.
 */
export async function snapshotWorkingTree(repo: string): Promise<Snapshot> {
  const gitDir = (await git(["rev-parse", "--absolute-git-dir"], { cwd: repo })).trim();
  const tmpIndex = join(gitDir, `intuition-index-${process.pid}-${randomBytes(4).toString("hex")}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    try {
      await copyFile(join(gitDir, "index"), tmpIndex);
    } catch {
      // No index yet (fresh repo): start empty.
    }
    await git(["add", "-u", "--ignore-errors", "--", ".", OWN_PATHSPEC], { cwd: repo, env, allowFail: true });
    const untracked = (await git(["ls-files", "--others", "--exclude-standard", "-z", "--", ".", OWN_PATHSPEC], { cwd: repo }))
      .split("\0")
      .filter(Boolean);
    const include: string[] = [];
    const skippedLarge: string[] = [];
    for (const file of untracked) {
      const info = await stat(join(repo, file)).catch(() => null);
      if (!info?.isFile()) continue;
      if (info.size > MAX_UNTRACKED_BYTES) skippedLarge.push(file);
      else include.push(file);
    }
    if (include.length > 0) {
      await git(["add", "--ignore-errors", "--pathspec-from-file=-", "--pathspec-file-nul"], {
        cwd: repo,
        env,
        input: include.join("\0"),
        allowFail: true,
      });
    }
    const tree = (await git(["write-tree"], { cwd: repo, env })).trim();
    return { tree, skippedLarge };
  } finally {
    await rm(tmpIndex, { force: true });
  }
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed";

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  added: number;
  deleted: number;
  binary: boolean;
}

export interface CapturedDiff {
  base: string;
  head: string;
  files: ChangedFile[];
  /** Patch text handed to the reviewer (possibly shortened). */
  patch: string;
  /** Short "M path (+3 -1)" listing of every changed file. */
  summary: string;
  truncated: boolean;
  totalAdded: number;
  totalDeleted: number;
}

export interface DiffLimits {
  maxChars: number;
  maxFileChars: number;
}

export const DEFAULT_LIMITS: DiffLimits = { maxChars: 120_000, maxFileChars: 20_000 };

const STATUS_CODES: Record<string, FileStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-changed",
};

function parseNameStatus(out: string): ChangedFile[] {
  const parts = out.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    if (!code) continue;
    const status = STATUS_CODES[code[0] ?? ""] ?? "modified";
    if (status === "renamed" || status === "copied") {
      const oldPath = parts[i++] ?? "";
      const path = parts[i++] ?? "";
      files.push({ path, oldPath, status, added: 0, deleted: 0, binary: false });
    } else {
      files.push({ path: parts[i++] ?? "", status, added: 0, deleted: 0, binary: false });
    }
  }
  return files;
}

function applyNumstat(files: ChangedFile[], out: string): void {
  // -z numstat: "a\td\tpath\0" or, for renames, "a\td\t\0old\0new\0".
  const parts = out.split("\0");
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (let i = 0; i < parts.length; ) {
    const head = parts[i++];
    if (!head) continue;
    const [a, d, p] = head.split("\t");
    let path = p ?? "";
    if (!path) {
      i++; // old path
      path = parts[i++] ?? "";
    }
    const file = byPath.get(path);
    if (!file) continue;
    file.binary = a === "-";
    file.added = Number(a) || 0;
    file.deleted = Number(d) || 0;
  }
}

/** Split a unified diff into per-file chunks keyed by the post-image path. */
function splitPatch(patch: string): Map<string, string> {
  const chunks = new Map<string, string>();
  const pieces = patch.split(/^(?=diff --git )/m).filter((p) => p.startsWith("diff --git "));
  for (const piece of pieces) {
    const plus = /^\+\+\+ b\/(.+)$/m.exec(piece)?.[1];
    const rename = /^rename to (.+)$/m.exec(piece)?.[1];
    const header = /^diff --git a\/.+? b\/(.+)$/m.exec(piece)?.[1];
    const path = plus ?? rename ?? header;
    if (path) chunks.set(path.trim(), piece);
  }
  return chunks;
}

/** Diff two tree-ish ids and shape the result for a reviewer prompt, staying inside size limits. */
export async function captureDiff(
  repo: string,
  base: string,
  head: string,
  limits: DiffLimits = DEFAULT_LIMITS,
  extraNotes: string[] = [],
): Promise<CapturedDiff> {
  const range = [base, head, "--", ".", OWN_PATHSPEC];
  const files = parseNameStatus(await git(["diff", "--name-status", "-z", "-M", ...range], { cwd: repo }));
  applyNumstat(files, await git(["diff", "--numstat", "-z", "-M", ...range], { cwd: repo }));
  const fullPatch = files.length
    ? await git(["diff", "--no-ext-diff", "--no-textconv", "-M", "--unified=3", ...range], { cwd: repo })
    : "";
  const chunks = splitPatch(fullPatch);

  let truncated = false;
  let budget = limits.maxChars;
  const shown: string[] = [];
  const omitted: string[] = [];
  for (const file of files) {
    const label = `${file.path} (+${file.added} -${file.deleted})`;
    if (file.binary) {
      shown.push(`--- ${file.path}: binary file ${file.status} (contents not shown)\n`);
      continue;
    }
    if (NOISY_FILE.test(file.path)) {
      shown.push(`--- ${label}: generated/lock file ${file.status}; contents not shown\n`);
      continue;
    }
    let chunk = chunks.get(file.path) ?? "";
    if (!chunk) continue;
    if (chunk.length > limits.maxFileChars) {
      chunk = `${chunk.slice(0, limits.maxFileChars)}\n… [${file.path}: ${chunk.length - limits.maxFileChars} more characters not shown]\n`;
      truncated = true;
    }
    if (chunk.length > budget) {
      omitted.push(label);
      truncated = true;
      continue;
    }
    budget -= chunk.length;
    shown.push(chunk);
  }
  if (omitted.length) {
    shown.push(
      `\n[Not shown to keep the review fast: ${omitted.length} file(s). Open them with your read tools if they matter]\n${omitted.map((o) => `  ${o}`).join("\n")}\n`,
    );
  }
  for (const note of extraNotes) shown.push(`\n[${note}]\n`);

  const totalAdded = files.reduce((n, f) => n + f.added, 0);
  const totalDeleted = files.reduce((n, f) => n + f.deleted, 0);
  const summary = files
    .map((f) => `${f.status === "type-changed" ? "T" : f.status[0]!.toUpperCase()} ${f.oldPath ? `${f.oldPath} -> ` : ""}${f.path} (${f.binary ? "binary" : `+${f.added} -${f.deleted}`})`)
    .join("\n");
  return { base, head, files, patch: shown.join(""), summary, truncated, totalAdded, totalDeleted };
}
