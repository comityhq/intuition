import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";

/** Find an executable on PATH (honouring PATHEXT on Windows). Returns null when missing. */
export function which(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const exts =
    process.platform === "win32"
      ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase())]
      : [""];
  const candidates = isAbsolute(command) ? [command] : (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean).map((d) => join(d, command));
  for (const base of candidates) {
    for (const ext of exts) {
      const full = base + ext;
      if (process.platform === "win32" && ext === "" && !extname(full)) continue;
      try {
        if (existsSync(full) && statSync(full).isFile()) return full;
      } catch {
        // unreadable entry on PATH
      }
    }
  }
  return null;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  cwd: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

/** Quote one argument for cmd.exe (used only for .cmd/.bat shims, whose arguments are flags and ids). */
function cmdQuote(arg: string): string {
  if (/^[\w@%+=:,./\\-]+$/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1").replace(/%/g, '"^%"')}"`;
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

/**
 * Run an external program with no shell, prompt on stdin, and a hard timeout that kills the whole process tree.
 * Windows .cmd/.bat shims (npm-installed CLIs) are run through cmd.exe with quoted arguments.
 */
export function run(executable: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const isShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
  const file = isShim ? (process.env.ComSpec ?? "cmd.exe") : executable;
  const argv = isShim ? ["/d", "/s", "/c", `"${[executable, ...args].map(cmdQuote).join(" ")}"`] : args;
  const child = spawn(file, argv, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    windowsVerbatimArguments: isShim,
    detached: process.platform !== "win32",
  });
  const { promise, resolve } = Promise.withResolvers<RunResult>();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child.pid);
  }, opts.timeoutMs);
  child.on("error", (err) => {
    clearTimeout(timer);
    resolve({ code: null, stdout, stderr: `${stderr}${err.message}`, timedOut });
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    resolve({ code, stdout, stderr, timedOut });
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(opts.input ?? "");
  return promise;
}
