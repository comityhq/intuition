# Security policy

Comity Intuition runs entirely on your machine. It has no server, no account and no telemetry. Reviews are run by the agent CLI you already use (`claude`, `codex`, `gemini`) with read-only tools.

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Instead:

- Use GitHub's private reporting: **Security → Report a vulnerability** on [comityhq/intuition](https://github.com/comityhq/intuition/security/advisories/new), or
- Email **hello@comity.so** with the subject "Security report".

Include what you found, how to reproduce it, and the version (from `package.json` or `npm ls -g comity-intuition`). We aim to reply within 3 business days and to fix confirmed issues quickly, crediting you if you'd like.

## In scope

- A reviewer that can change files, run commands or reach the network despite the read-only setup
- Hooks that modify the user's git index, branches, history or working tree
- Prompt injection from reviewed code or conversations that makes Intuition itself take an action (beyond affecting the text of a review)
- Secrets copied into reports, or reports committed by accident
- Unsafe handling of hook input, config files or environment variables

Supported versions: the latest published release.
