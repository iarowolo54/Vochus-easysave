---
description: Pre-PR gate — verify, review, and draft the PR description
argument-hint: '[base branch, default main]'
---

Run the pre-PR gate against base branch: $ARGUMENTS (default `main`).

1. `/verify` flow via the **test-runner** subagent (typecheck + build). Stop and report if anything fails.
2. `/review-changes` flow (code-reviewer, + security-auditor if sensitive paths changed, + ux-reviewer if UI changed). List blockers.
3. Check: Prisma schema changes have a migration (not just `db push`); migrations are forward-only; any new money-movement is wrapped in a transaction with an atomic balance guard; no secrets added to code; no `.only`/`.skip`; commit messages have no Claude attribution line.
4. Draft the PR description:
   ```
   ## What
   ## Why
   ## How
   ## Screenshots (UI changes)
   ## Migration? yes/no — details
   ## Money / auth touched? yes/no — what was checked
   ## Test plan
   ```
5. Give a go / no-go summary. **No-go** unless `npx tsc --noEmit` and `npm run build` both succeeded during this run. Do not push or open the PR unless I ask.
