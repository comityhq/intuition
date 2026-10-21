# Contributing to Comity Intuition

Thanks for helping. Intuition is small on purpose. It's a TypeScript CLI with no runtime dependencies, and every change should keep it that way unless there's a very good reason.

## Setup

```bash
npm install
npm run build        # tsc -> dist/
npm test             # vitest
node dist/cli.js --help
```

Node 22+ and git are required. You only need Claude Code or Codex installed for real end-to-end runs. The tests don't call any AI.

## Layout

| Path | What it does |
| --- | --- |
| `src/cli.ts` | Commands and flags |
| `src/hook.ts` | Claude Code / Codex hook handlers (UserPromptSubmit snapshot, Stop review), loop prevention |
| `src/git.ts` | Working-tree snapshots (temporary index, never touches the user's index) and diff capture with size limits |
| `src/review.ts` | Picks the reviewer, builds the prompt, runs it and saves the report |
| `src/reviewers.ts` | How each agent is run read-only (`claude -p --resume --fork-session`, `codex exec [fork]`, `gemini -p`) |
| `src/prompt.ts` | The reviewer brief. This is the heart of the product |
| `src/report/*` | Report types, JSON Schema, normalisation and verdict calibration, Markdown/HTML rendering, storage |
| `src/install.ts` | Idempotent init/uninstall of hooks in `.claude/settings.json` and `.codex/hooks.json` |
| `src/doctor.ts` | Setup checks |
| `test/` | Vitest suites: diff capture, hook I/O, loop prevention, idempotent init, rendering |
| `examples/` | Real reports produced by real agent runs |

## Ground rules

- **The reviewer must stay read-only.** Never give a reviewer write, shell or network tools.
- **Hooks never block the user on failure.** They exit 0, explain the problem in one line, and log it to `.intuition/hook.log`.
- **No loops.** Any new trigger must respect `stop_hook_active`, the `COMITY_INTUITION_REVIEWER_RUN` guard and the "already reviewed this snapshot" check.
- **Plain English.** Every user-facing string, including errors, should make sense to someone who has never opened a terminal before. Explain jargon once, in brackets.
- **The report JSON is a public contract** (`src/report/types.ts`). Additive changes only, and bump `version` for breaking ones.
- **Prompt changes need evidence.** If you change `src/prompt.ts`, run real reviews on a few varied changes (safe copy edit, real bug, risky payment/data change) and describe the before/after in your PR.

## Pull requests

1. Open an issue first for anything big.
2. Keep PRs focused, and add or adjust tests.
3. Make sure `npm run build` and `npm test` both pass.
4. Note user-visible changes in `CHANGELOG.md`.

By contributing, you agree that your contributions are licensed under the MIT licence.
