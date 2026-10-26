---
description: Review current changes with code-reviewer (+ security-auditor when sensitive paths changed, + ux-reviewer when UI changed) and summarize findings
argument-hint: '[git ref or path, default: uncommitted + branch changes]'
---

1. Determine the change set: $ARGUMENTS if given, else `git diff` + `git diff --staged` (and `git diff main...HEAD` if on a branch). If not a git repo, ask me which files to review.
2. Launch the **code-reviewer** subagent on the change set.
3. In parallel, if any changed path touches `src/app/api/admin/`, `src/app/api/superadmin/`, `src/lib/auth*.ts`, `src/lib/customer-auth.ts`, `src/lib/paystack.ts`, anything under `paystack`/`webhook`/`withdrawal`/`redemption`/`loans`, or `prisma/schema.prisma` — also launch the **security-auditor** subagent.
   3b. If any changed path is under `src/app/**/page.tsx` or `src/components/` — also launch the **ux-reviewer** subagent in parallel.
4. Merge results into one list, deduplicated, most severe first: severity · file:line · issue · fix.
5. Finish with a verdict and ask whether to apply the fixes.
