import { spawn } from "node:child_process";

/** Open a local file with the system's default app (the browser, for .html). Fire and forget. */
export function openInBrowser(path: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["explorer.exe", [path]]
      : process.platform === "darwin"
        ? ["open", [path]]
        : ["xdg-open", [path]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // No desktop available (CI, SSH): the path is printed anyway.
  }
}
