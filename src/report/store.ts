import { randomBytes } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureIntuitionDir, readJsonFile, reportsDir } from "../paths.js";
import { renderHtml, renderMarkdown } from "./render.js";
import type { Report } from "./types.js";

export interface SavedReport {
  json: string;
  md: string;
  html: string;
}

/** Sortable, filename-safe id: 2026-10-21T14-03-30-ab12cd */
export function newReportId(now = new Date()): string {
  return `${now.toISOString().slice(0, 19).replace(/:/g, "-")}-${randomBytes(3).toString("hex")}`;
}

export function reportPaths(repo: string, id: string): SavedReport {
  const base = join(reportsDir(repo), id);
  return { json: `${base}.json`, md: `${base}.md`, html: `${base}.html` };
}

export async function saveReport(repo: string, report: Report): Promise<SavedReport> {
  await ensureIntuitionDir(repo);
  const paths = reportPaths(repo, report.id);
  await writeFile(paths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(paths.md, renderMarkdown(report), "utf8");
  await writeFile(paths.html, renderHtml(report), "utf8");
  return paths;
}

export async function listReportIds(repo: string): Promise<string[]> {
  const names = await readdir(reportsDir(repo)).catch(() => [] as string[]);
  return names
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -5))
    .sort();
}

/** Load a report by id, unique id prefix, or the newest one when `id` is null. */
export async function loadReport(repo: string, id: string | null): Promise<Report | null> {
  const ids = await listReportIds(repo);
  const match = id === null ? ids.at(-1) : (ids.find((x) => x === id) ?? ids.filter((x) => x.startsWith(id)).at(-1));
  if (!match) return null;
  return readJsonFile<Report>(reportPaths(repo, match).json);
}
