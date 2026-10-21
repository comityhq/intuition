import { readFile } from "node:fs/promises";

/**
 * Turn a Claude Code or Codex session transcript (JSONL) into a short, readable conversation excerpt.
 * Used when the reviewer can't fork the builder's session (cross-vendor review), so it still knows
 * what the user asked for and what the agent said it did.
 */

interface Entry {
  role: "User" | "Agent" | "Tool";
  text: string;
}

const MAX_ENTRY = 2_000;
const DEFAULT_BUDGET = 24_000;

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Remove harness-injected blocks (system reminders, environment context) that are noise for a reviewer. */
function stripInjected(text: string): string {
  return text
    .replace(/<(system-reminder|environment_context|user_instructions|permissions instructions|local-command-stdout)[^>]*>[\s\S]*?<\/\1>/g, "")
    .trim();
}

function describeToolCall(name: string, input: unknown): string {
  let args: Record<string, unknown> = {};
  if (typeof input === "string") {
    try {
      args = JSON.parse(input) as Record<string, unknown>;
    } catch {
      return `${name}: ${clip(input, 160)}`;
    }
  } else if (input && typeof input === "object") {
    args = input as Record<string, unknown>;
  }
  const detail = [args.file_path, args.path, args.notebook_path, args.command, args.cmd, args.pattern, args.url]
    .find((v) => typeof v === "string" || Array.isArray(v));
  return detail ? `${name}: ${clip(Array.isArray(detail) ? detail.join(" ") : String(detail), 160)}` : name;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b && typeof b === "object" && "text" in b && typeof b.text === "string" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

function claudeEntries(lines: Record<string, unknown>[]): Entry[] {
  const out: Entry[] = [];
  for (const line of lines) {
    if (line.isMeta || line.isSidechain) continue;
    const message = line.message as { role?: string; content?: unknown } | undefined;
    if (!message) continue;
    if (line.type === "user") {
      const text = stripInjected(contentText(message.content));
      if (text && !text.startsWith("<command-") && !text.startsWith("Caveat:")) out.push({ role: "User", text });
    } else if (line.type === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content as Record<string, unknown>[]) {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          out.push({ role: "Agent", text: block.text });
        } else if (block.type === "tool_use" && typeof block.name === "string") {
          out.push({ role: "Tool", text: describeToolCall(block.name, block.input) });
        }
      }
    }
  }
  return out;
}

function codexEntries(lines: Record<string, unknown>[]): Entry[] {
  const out: Entry[] = [];
  for (const line of lines) {
    if (line.type !== "response_item") continue;
    const p = line.payload as Record<string, unknown> | undefined;
    if (!p) continue;
    if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
      const text = stripInjected(contentText(p.content));
      if (!text || text.startsWith("# AGENTS.md") || text.startsWith("<")) continue;
      out.push({ role: p.role === "user" ? "User" : "Agent", text });
    } else if ((p.type === "function_call" || p.type === "custom_tool_call") && typeof p.name === "string") {
      out.push({ role: "Tool", text: describeToolCall(p.name, p.arguments ?? p.input) });
    }
  }
  return out;
}

export function excerptFromJsonl(raw: string, budget = DEFAULT_BUDGET): string {
  const lines: Record<string, unknown>[] = [];
  for (const l of raw.split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      lines.push(JSON.parse(l) as Record<string, unknown>);
    } catch {
      // skip partial line (transcripts are appended while we read)
    }
  }
  const isCodex = lines.some((l) => l.type === "response_item" || l.type === "session_meta");
  const entries = isCodex ? codexEntries(lines) : claudeEntries(lines);
  if (entries.length === 0) return "";

  const render = (e: Entry) =>
    e.role === "Tool" ? `  (agent used ${clip(e.text, 200)})` : `${e.role}: ${clip(e.text, MAX_ENTRY)}`;
  const firstUser = entries.find((e) => e.role === "User");
  const head = firstUser ? `${render(firstUser)}\n` : "";
  const tail: string[] = [];
  let used = head.length;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry === firstUser) break;
    const line = render(entry);
    if (used + line.length + 1 > budget) {
      tail.unshift("  … (earlier conversation omitted) …");
      break;
    }
    used += line.length + 1;
    tail.unshift(line);
  }
  return `${head}${tail.join("\n")}`.trim();
}

export async function readTranscriptExcerpt(path: string | null, budget = DEFAULT_BUDGET): Promise<string> {
  if (!path) return "";
  try {
    return excerptFromJsonl(await readFile(path, "utf8"), budget);
  } catch {
    return "";
  }
}
