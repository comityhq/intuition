# Changelog

## 0.1.0

First release.

- `init` / `uninstall`: idempotent Claude Code (`.claude/settings.json`) and Codex (`.codex/hooks.json`) hooks, project or user scope, `--dry-run`.
- Automatic review after each agent turn that changed code. The reviewer is a read-only fork of the same session (`claude --resume --fork-session`, `codex exec fork`), and the agent relays the review in chat.
- Cross-vendor reviews and parallel second opinions (Claude, Codex, Gemini CLI) that use a conversation excerpt when the session can't be forked.
- `review` (working tree, `--since <ref>`, `--since last-turn`, `--session`), `report`, `doctor`, `config`.
- Reports as JSON, Markdown and a dark, forwardable HTML one-pager in `.intuition/reports/`.
