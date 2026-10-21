import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installHooks, isOurs, ourHooks, settingsFile, uninstallHooks } from "../src/install.js";
import { cleanup, tempDir, write } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));
const CMD = 'node "/opt/comity-intuition/dist/cli.js"';

function project() {
  const dir = tempDir();
  dirs.push(dir);
  return dir;
}
const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));

describe("init (Claude Code)", () => {
  it("creates .claude/settings.json with a Stop and a UserPromptSubmit hook", async () => {
    const dir = project();
    const file = settingsFile("claude", "project", dir);
    expect(file).toBe(join(dir, ".claude", "settings.json"));
    const change = await installHooks("claude", file, false, CMD);
    expect(change.action).toBe("created");
    const settings = read(file);
    expect(settings.hooks.Stop[0].hooks[0]).toMatchObject({
      type: "command",
      command: `${CMD} hook stop --agent claude`,
      timeout: 900,
    });
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe(`${CMD} hook prompt --agent claude`);
  });

  it("is idempotent: running twice changes nothing", async () => {
    const dir = project();
    const file = settingsFile("claude", "project", dir);
    await installHooks("claude", file, false, CMD);
    const first = readFileSync(file, "utf8");
    const again = await installHooks("claude", file, false, CMD);
    expect(again.action).toBe("unchanged");
    expect(readFileSync(file, "utf8")).toBe(first);
  });

  it("keeps the user's own settings and hooks, and replaces an outdated copy of ours", async () => {
    const dir = project();
    const file = settingsFile("claude", "project", dir);
    const theirs = { type: "command", command: "npm run lint" };
    write(dir, ".claude/settings.json", JSON.stringify({
      model: "sonnet",
      permissions: { allow: ["Bash(npm test)"] },
      hooks: {
        Stop: [{ hooks: [theirs] }, { hooks: [{ type: "command", command: 'node "/old/comity-intuition/dist/cli.js" hook stop --agent claude' }] }],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
      },
    }));
    expect((await installHooks("claude", file, false, CMD)).action).toBe("updated");
    const s = read(file);
    expect(s.model).toBe("sonnet");
    expect(s.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(s.hooks.Stop).toHaveLength(2);
    expect(s.hooks.Stop[0].hooks[0]).toEqual(theirs);
    expect(JSON.stringify(s)).not.toContain("/old/");
  });

  it("dry run writes nothing", async () => {
    const dir = project();
    const file = settingsFile("claude", "project", dir);
    expect((await installHooks("claude", file, true, CMD)).action).toBe("created");
    expect(existsSync(file)).toBe(false);
  });

  it("refuses to touch a settings file that isn't valid JSON", async () => {
    const dir = project();
    write(dir, ".claude/settings.json", "{ broken");
    await expect(installHooks("claude", settingsFile("claude", "project", dir), false, CMD)).rejects.toThrow(/isn't valid JSON/);
    expect(readFileSync(join(dir, ".claude/settings.json"), "utf8")).toBe("{ broken");
  });

  it("uninstall removes only our hooks", async () => {
    const dir = project();
    const file = settingsFile("claude", "project", dir);
    write(dir, ".claude/settings.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } }));
    await installHooks("claude", file, false, CMD);
    expect((await uninstallHooks("claude", file, false)).action).toBe("removed");
    expect(read(file)).toEqual({ hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } });
    expect((await uninstallHooks("claude", file, false)).action).toBe("not-found");
  });
});

describe("init (Codex)", () => {
  it("writes .codex/hooks.json and uninstall deletes a file that only held our hooks", async () => {
    const dir = project();
    const file = settingsFile("codex", "project", dir);
    expect(file).toBe(join(dir, ".codex", "hooks.json"));
    const change = await installHooks("codex", file, false, CMD);
    expect(change.note).toMatch(/\/hooks/);
    expect(read(file).hooks.Stop[0].hooks[0].command).toBe(`${CMD} hook stop --agent codex`);
    await uninstallHooks("codex", file, false);
    expect(existsSync(file)).toBe(false);
  });

  it("keeps a Codex hooks.json that has other hooks", async () => {
    const dir = project();
    const file = settingsFile("codex", "project", dir);
    write(dir, ".codex/hooks.json", JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }] } }));
    await installHooks("codex", file, false, CMD);
    await uninstallHooks("codex", file, false);
    expect(read(file)).toEqual({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo start" }] }] } });
  });
});

describe("hook ownership", () => {
  it("recognises our hooks by marker or command, and nobody else's", () => {
    for (const handler of ourHooks("claude", CMD).Stop![0]!.hooks!) expect(isOurs(handler)).toBe(true);
    expect(isOurs({ type: "command", command: "npx -y comity-intuition@0.1.0 hook stop --agent claude" })).toBe(true);
    expect(isOurs({ type: "command", command: "npm test" })).toBe(false);
    expect(isOurs({ type: "command", command: "intuition-lint --fix" })).toBe(false);
  });

  it("user scope points at the agent's home config", () => {
    const fakeHome = project();
    process.env.CLAUDE_CONFIG_DIR = fakeHome;
    try {
      expect(settingsFile("claude", "user", null)).toBe(join(fakeHome, "settings.json"));
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
    expect(() => settingsFile("claude", "project", null)).toThrow(/git repository/);
  });
});
