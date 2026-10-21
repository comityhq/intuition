import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_TREE, captureDiff, findRepoRoot, resolveTreeish, snapshotWorkingTree } from "../src/git.js";
import { cleanup, sh, tempDir, tempRepo, write } from "./helpers.js";

const dirs: string[] = [];
const repo = (files?: Record<string, string>, commit?: boolean) => {
  const d = tempRepo(files, commit);
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach(cleanup));

describe("snapshotWorkingTree", () => {
  it("captures modified, deleted and untracked files without touching the index", async () => {
    const dir = repo({ "a.txt": "one\n", "b.txt": "bee\n", ".gitignore": "secret.env\n" });
    write(dir, "a.txt", "one\ntwo\n");
    rmSync(join(dir, "b.txt"));
    write(dir, "new/c.txt", "sea\n");
    write(dir, "secret.env", "TOKEN=1\n");
    write(dir, "staged.txt", "staged\n");
    sh(dir, "add", "staged.txt");
    const statusBefore = sh(dir, "status", "--porcelain");

    const snap = await snapshotWorkingTree(dir);
    const files = sh(dir, "ls-tree", "-r", "--name-only", snap.tree).trim().split("\n").sort();

    expect(files).toEqual([".gitignore", "a.txt", "new/c.txt", "staged.txt"]);
    expect(sh(dir, "status", "--porcelain")).toBe(statusBefore);
    expect(sh(dir, "diff", "--cached", "--name-only").trim()).toBe("staged.txt");
  });

  it("is stable: same working tree gives the same tree id", async () => {
    const dir = repo();
    write(dir, "x.txt", "x\n");
    expect((await snapshotWorkingTree(dir)).tree).toBe((await snapshotWorkingTree(dir)).tree);
  });

  it("never includes its own .intuition folder", async () => {
    const dir = repo();
    write(dir, ".intuition/reports/r.json", "{}");
    const snap = await snapshotWorkingTree(dir);
    expect(sh(dir, "ls-tree", "-r", "--name-only", snap.tree)).not.toContain(".intuition");
  });

  it("lists big untracked files instead of hashing them", async () => {
    const dir = repo();
    write(dir, "video.bin", Buffer.alloc(3 * 1024 * 1024, 1));
    const snap = await snapshotWorkingTree(dir);
    expect(snap.skippedLarge).toEqual(["video.bin"]);
    expect(sh(dir, "ls-tree", "-r", "--name-only", snap.tree)).not.toContain("video.bin");
  });
});

describe("captureDiff", () => {
  it("reports statuses, line counts and the patch", async () => {
    const dir = repo({ "src/app.js": "a\nb\n", "old.js": "gone\n", "keep.js": "k\n" });
    write(dir, "src/app.js", "a\nB\nc\n");
    rmSync(join(dir, "old.js"));
    write(dir, "added.js", "new\n");
    const base = await resolveTreeish(dir, "HEAD");
    const diff = await captureDiff(dir, base, (await snapshotWorkingTree(dir)).tree);

    const byPath = Object.fromEntries(diff.files.map((f) => [f.path, f]));
    expect(byPath["src/app.js"]).toMatchObject({ status: "modified", added: 2, deleted: 1 });
    expect(byPath["old.js"]).toMatchObject({ status: "deleted", deleted: 1 });
    expect(byPath["added.js"]).toMatchObject({ status: "added", added: 1 });
    expect(diff.patch).toContain("+B");
    expect(diff.summary).toContain("M src/app.js (+2 -1)");
    expect(diff.truncated).toBe(false);
  });

  it("detects renames", async () => {
    const dir = repo({ "before.txt": "line 1\nline 2\nline 3\nline 4\n" });
    sh(dir, "mv", "before.txt", "after.txt");
    const diff = await captureDiff(dir, await resolveTreeish(dir, "HEAD"), (await snapshotWorkingTree(dir)).tree);
    expect(diff.files).toEqual([expect.objectContaining({ path: "after.txt", oldPath: "before.txt", status: "renamed" })]);
  });

  it("summarises lock files and binaries instead of dumping them", async () => {
    const dir = repo({ "package-lock.json": "{}\n" });
    write(dir, "package-lock.json", `${JSON.stringify({ lots: "x".repeat(5000) })}\n`);
    write(dir, "logo.png", Buffer.from([0, 1, 2, 0, 255, 0, 3]));
    const diff = await captureDiff(dir, await resolveTreeish(dir, "HEAD"), (await snapshotWorkingTree(dir)).tree);
    expect(diff.patch).toContain("package-lock.json (+1 -1): generated/lock file modified; contents not shown");
    expect(diff.patch).toContain("logo.png: binary file added");
    expect(diff.patch).not.toContain("xxxxx");
  });

  it("truncates big diffs and says so", async () => {
    const dir = repo();
    write(dir, "big1.txt", "a\n".repeat(4000));
    write(dir, "big2.txt", "b\n".repeat(4000));
    write(dir, "small.txt", "tiny\n");
    const diff = await captureDiff(dir, await resolveTreeish(dir, "HEAD"), (await snapshotWorkingTree(dir)).tree, {
      maxChars: 6000,
      maxFileChars: 3000,
    });
    expect(diff.truncated).toBe(true);
    expect(diff.patch.length).toBeLessThan(9000);
    expect(diff.patch).toContain("more characters not shown");
    expect(diff.files).toHaveLength(3);
  });

  it("works in a repository without any commit", async () => {
    const dir = repo({ "first.js": "hello\n" }, false);
    const base = await resolveTreeish(dir, "HEAD");
    expect(base).toBe(EMPTY_TREE);
    const diff = await captureDiff(dir, base, (await snapshotWorkingTree(dir)).tree);
    expect(diff.files.map((f) => f.path)).toEqual(["first.js"]);
  });

  it("returns no files when nothing changed", async () => {
    const dir = repo();
    const diff = await captureDiff(dir, await resolveTreeish(dir, "HEAD"), (await snapshotWorkingTree(dir)).tree);
    expect(diff.files).toEqual([]);
  });
});

describe("repo helpers", () => {
  it("finds the repo root from a subfolder and returns null outside git", async () => {
    const dir = repo({ "sub/x.txt": "x" });
    expect(await findRepoRoot(join(dir, "sub"))).toBe(dir);
    const outside = tempDir();
    dirs.push(outside);
    expect(await findRepoRoot(outside)).toBeNull();
  });

  it("explains unknown refs in plain words", async () => {
    const dir = repo();
    await expect(resolveTreeish(dir, "no-such-branch")).rejects.toThrow(/Can't find "no-such-branch"/);
  });
});
