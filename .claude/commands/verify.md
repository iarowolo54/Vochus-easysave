---
description: Run typecheck and build (via the test-runner subagent) and report results
argument-hint: '[--build-only]'
---

Use the **test-runner** subagent to run this project's checks and return a concise summary.

Note: `next.config.ts` sets `ignoreBuildErrors: true`, so the build alone does NOT catch type errors. Default run = `npx tsc --noEmit` **and** `npm run build`. With `--build-only`, run only the build.

After it returns:

- If everything passed, say so in one line.
- If anything failed, list the failures and propose fixes (do not apply them unless I ask).
- Never report a pass that wasn't observed.
