# Safe to ship: The README now has a short "Running locally" section explaining how to start the shop and run its tests. It's documentation only and safe to ship.

**Verdict:** GREEN · **Project:** tiny-shop · **When:** 21 Oct 2026, 14:27

## What changed

- Added a "Running locally" section to the README, the project's front-page instructions for developers.
- It explains how to start the shop's server, which runs on port 3000 (the local web address it uses) unless a different port is set.
- It explains how to run the automated tests.
- It notes there is nothing to install apart from Node.js (the program that runs the shop's code).
- The shop itself, customers and checkout are unaffected. The work was saved on its own branch (a separate copy of the code). It was not published or turned into a PR (a request to merge the change) because the project has no online copy set up yet.

## Things to check

Nothing worth worrying about was found in these changes.

## Questions to ask a developer

1. Should the README also say which minimum version of Node.js is needed? The built-in test runner only exists in fairly recent versions.
2. Where should this repository live online (for example GitHub) so this branch can be published and opened as a pull request?

## Good news

- The instructions match the project. The start and test commands, the default port 3000 and the option to change the port were all checked against the code.
- The change is limited to documentation and doesn't touch any code customers use.
- The existing tests still pass.

## About this review

- Reviewer: Claude Code (claude-opus-5-5), as a forked copy of the coding session, so it knew what was asked and why
- Files reviewed (1): `README.md`
- Report id: `2026-10-21T18-27-24-ad5d71`

---

Reviewed by Comity Intuition · free & open source · comity.so
