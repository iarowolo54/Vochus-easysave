---
description: Run a focused auth / money-movement security audit with the security-auditor subagent
argument-hint: "[scope: path, module, or 'full']"
---

Launch the **security-auditor** subagent with scope: $ARGUMENTS (default: current changes; `full` = whole codebase).

Ask it to trace, for each actor (customer, agent, sub-agent, staff, super admin):

- can they reach an endpoint or data that isn't theirs (IDOR, missing role check on admin routes)?
- can they move money they shouldn't (double withdrawal/redemption, payout redirection, payment reference reuse, webhook forgery)?
- are tokens/OTPs/secrets handled safely (crypto-random, ownership-checked, attempt-limited, not logged)?

Present findings ranked by severity with file:line and fix. Then list the tests that would have caught each finding (there is currently no test suite — note which ones to add first).
