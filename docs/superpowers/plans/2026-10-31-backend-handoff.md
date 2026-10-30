# Backend Handoff Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the open backend items in `docs/backend-handoff.md` — the security/money races and leaks (19–22), the two customer-list enrichments the redesign UI is blocked on (24–25), and the smaller admin-API gaps (23).

**Architecture:** Each item is an independent fix to an existing API route or a small shared helper. Highest-risk money/security items first, then the UI-blocking data items, then the grab-bag. No new feature surface.

**Tech Stack:** Next.js App Router route handlers, Prisma + SQLite, the three auth systems, `wallet-guard`/`wallet-rates` for money, `logAudit`.

**Spec:** `docs/backend-handoff.md` — the authoritative, per-item spec. Each task below names its item number; the implementer reads that item's full text (it carries the exact acceptance criteria and the "Check:" lines). Also read `.claude/rules/auth-security.md`, `backend-api.md`, `database.md`.

## Global Constraints
- **Authorization server-side** (see auth-security.md): admin routes require `role==='superadmin'`, not just a session; own-the-data checks scope every id to its owner; never trust ids/roles from the client body.
- **Money races:** guard every real-money status change with a CONDITIONAL `updateMany({ where: { id, status:'Pending' /* or balance gte */ }, data })` and check the returned `count` — never read-then-write. Wrap multi-row balance moves in `prisma.$transaction`.
- **Secrets never returned/logged:** no password/PIN hashes, biometric/device fields, OTPs, or base64 blobs (`photoUrl`, `fileData`) in responses, list endpoints, or logs.
- **Do NOT change the request/response shape of `/api/customer/enroll`** (the UI depends on it). The `?search=<cid>&limit=1` lookups in savings/loan-request/enrol against `/api/customers` must keep working.
- Money is `Float`; round with `money()`. No new `any`/`as any`. Keep `npx tsc --noEmit` at its 23-error baseline. Migrations forward-only (none expected here; these are code-only unless an item says otherwise).
- Tests run `NEXTAUTH_SECRET=test npx tsx --test tests/<file>`; node:test runs files in parallel against one dev.db — scope rows by a unique run id, clean up only your own rows (no table-wide `deleteMany({})`). Mock the admin/agent/customer session the way existing int tests do (e.g. `tests/customer-me-interest.int.test.ts` for the customer-cookie override; find an admin-session example for `requireSuperAdmin` routes, else construct the NextAuth session the route reads).
- `AuditLog` is append-only.

## Review Focus
- **A second click / second admin on a money action** (withdrawal approve, redemption approve, refund, commission payout) must not move money twice. → Task 5.
- **A non-superadmin token in the admin cookie** must not pass an admin route (role check, not bare session). → Tasks 4,5,6,7 (verify each touched route checks role).
- **An admin detail/list response** must never carry a password/PIN hash or a base64 blob. → Tasks 3,4.
- **`?type`/`?sort`/plan-length filters applied AFTER paging** return short pages and wrong totals — they must be in the `where` before paging. → Task 2.
- **A blocked or expired card** must not become usable via link/relink. → Task 7.

---

### Task 1: Shared customer-type + last-paid helper (pure)
**Item:** supports 24 & 25 (they must share one definition so filter and field never disagree).
**Files:** Create `src/lib/customer-type.ts`; Test `tests/customer-type.test.ts`.
**Interfaces:**
- `customerType(plans: { source: string }[]): 'online' | 'offline'` — `online` if ANY plan has `source==='self'`, else `offline`.
- `lastPaidAtOf(deposits: { createdAt: Date }[]): string | null` — ISO string of the max `createdAt`, or `null`. (The DB `groupBy(_max.createdAt)` happens in the routes; this formats/derives.)

- [ ] Step 1: failing unit test — `customerType([{source:'self'}])==='online'`; `customerType([{source:'agent'}])==='offline'`; `customerType([{source:'agent'},{source:'self'}])==='online'`; `customerType([])==='offline'`; `lastPaidAtOf([])===null`; `lastPaidAtOf([{createdAt:d1},{createdAt:d2}])` returns the later ISO.
- [ ] Step 2: run, fails. Step 3: implement (pure). Step 4: passes. Step 5: commit `feat(handoff): shared customer-type helper`.

---

### Task 2: Item 24 — agent `/api/customers` enrichment
**Item:** backend-handoff.md item 24 (read it fully — it has the exact `type`/`lastPaidAt`/`?type`/`?sort=lastPaid`/`summary` rules + the "Check:" line + the plan-length-filter-after-paging bug #6).
**Files:** Modify `src/app/api/customers/route.ts`; Test `tests/customers-list.int.test.ts`.
**Consumes:** `customerType`, `lastPaidAtOf` (Task 1).
- [ ] Step 1: failing int test asserting item 24's "Check:" line — `?type=offline&sort=lastPaid&limit=10` returns only agent-created customers, never-paid first, with `summary`; `?type=online` returns only self-enrolled, no `summary`; every row has `type` + `lastPaidAt` and NO `password`; no-param response = today's shape plus the two fields; the `?search=<cid>&limit=1` lookup still works. Use one `transaction.groupBy(_max.createdAt)` for lastPaid (not per-customer). Scope rows by run id.
- [ ] Step 2–4: fail → implement (type/lastPaid fields; `?type` filter in `where` before paging via `savingsPlans: { some: { source:'self' } }` / `none`; `?sort=lastPaid` applied before paging; `summary` only for `type=offline`; move the plan-length filter into the `where`). Step 5: commit `feat(handoff): item 24 — customer list type/lastPaid/summary`.

---

### Task 3: Item 25 — admin `/api/admin/customers` enrichment
**Item:** backend-handoff.md item 25 (same `type`/`lastPaidAt` definitions as 24, via the shared helper; drop `photoUrl`; add `gender`,`state`,`lga`; KEEP returning the full list — do NOT add server paging).
**Files:** Modify `src/app/api/admin/customers/route.ts`; Test `tests/admin-customers-list.int.test.ts`.
**Consumes:** `customerType`, `lastPaidAtOf` (Task 1).
- [ ] Step 1: failing int test — every row has `type` + `lastPaidAt`, no row has `photoUrl` or `password`, rows carry `gender`/`state`/`lga`; agent-created → `offline`, self-enrolled → `online` (same as /api/customers for the same customer). `requireSuperAdmin` enforced. Scope by run id.
- [ ] Step 2–4: fail → implement. Step 5: commit `feat(handoff): item 25 — admin customer list type/lastPaid, drop photo`.

---

### Task 4: Item 20 — admin agent detail stops returning secrets
**Item:** backend-handoff.md item 20.
**Files:** Modify `src/app/api/admin/agents/[id]/detail/route.ts`; Test `tests/admin-agent-detail.int.test.ts`.
- [ ] Step 1: failing int test — the response contains NO `password`, PIN, biometric/device fields, or base64 `photoUrl`/`fileData` on the agent or any nested customer; it still contains the fields the page shows (match `src/app/superadmin/agents/[id]/page.tsx` types). Route requires superadmin.
- [ ] Step 2–4: fail → replace the `include` tree with explicit `select`s of only the displayed fields. Step 5: commit `feat(handoff): item 20 — explicit selects, no secret leakage in agent detail`.

---

### Task 5: Item 21 — payout races + PIN attempt limits
**Item:** backend-handoff.md item 21 (the four routes + the fix: conditional `updateMany` on status/balance, check `count`; add PIN attempt limits).
**Files:** Modify `src/app/api/admin/agent-withdrawal/[id]/route.ts`, `src/app/api/admin/agent-withdrawal/[id]/verify/route.ts`, `src/app/api/admin/early-redemption/[id]/route.ts`, `src/app/api/admin/wallets/commission-payout/route.ts`; Test `tests/payout-races.int.test.ts`.
**Interfaces:** each approve/refund/payout must become a conditional transition that pays out at most once.
- [ ] Step 1: failing int test — for each route: two concurrent/sequential approvals result in exactly ONE payout/state transition (the second returns a 409/conflict and moves no money); a wrong-PIN attempt beyond the limit is rejected. Use `Promise.all` for the race where feasible; assert balances/transaction counts. Scope by run id; seed the minimal rows each route needs.
- [ ] Step 2–4: fail → implement conditional `updateMany({ where:{ id, status:'Pending' }})` / `{ commissionBalance:{ gte } }` with `count` checks inside `$transaction`; add an attempt counter + lockout on the approval PIN. Keep existing audit. Step 5: commit `feat(handoff): item 21 — atomic payouts + PIN attempt limits`.

---

### Task 6: Item 19 — loan approve/reject status guard
**Item:** backend-handoff.md item 19.
**Files:** Modify `src/app/api/admin/loans/[id]/approve/route.ts` and `.../reject/route.ts`; Test `tests/loan-decision-guard.int.test.ts`.
- [ ] Step 1: failing int test — approving an already-decided (rejected/disbursed/repaid) loan returns 409 and does NOT flip status; same for reject; a genuinely Pending loan still approves/rejects once.
- [ ] Step 2–4: fail → `updateMany({ where:{ id, status:'Pending' }, data })`, return 409 when `count===0`. Step 5: commit `feat(handoff): item 19 — loan decision status guard`.

---

### Task 7: Item 22 — admin card unlink/relink hardening
**Item:** backend-handoff.md item 22.
**Files:** Modify `src/app/api/admin/cards/[serial]/route.ts`; Test `tests/admin-card-relink.int.test.ts`.
- [ ] Step 1: failing int test — unlink/relink REFUSE a `Blocked` or expired (`expiryDate` past) card (400); relink refuses a customer who already has a card; the audit records the real admin `actorId`/`actorName`, not a hardcoded `'SuperAdmin'`.
- [ ] Step 2–4: fail → implement the guards + real actor. Step 5: commit `feat(handoff): item 22 — card relink blocks blocked/expired, real actor`.

---

### Task 8: Item 23 — smaller admin-API gaps (batched)
**Item:** backend-handoff.md item 23 — the bulleted list. Fix the clearly-specified, low-risk ones in ONE batched change; each must get its own test assertion. At minimum: admin loan/card audit entries carry `actorId` (not just `'SuperAdmin'`); list endpoints `api/admin/customers`/`api/admin/wallets`/`api/admin/commission` drop base64 `photoUrl`; `api/admin/wallets/fund` validates `amount` type + upper bound via `wallet-guard`; 500s→404/400 for unparsed/ missing ids in `admin/customers/[id]/status`, `admin/agents/[id]/reset-device`, `admin/rewards/[id]`, `admin/reports/[id]/status`. Skip any sub-item that needs a product decision or a schema change (list it in the report as deferred, do not guess).
**Files:** the routes named in item 23; Test `tests/admin-api-gaps.int.test.ts`.
- [ ] Step 1: failing int test covering each fix you include (one assertion per sub-fix). Step 2–4: fail → implement the batch. Step 5: commit `feat(handoff): item 23 — admin API gaps (validation, no blobs, real actor, proper status codes)`.

---

## Notes
- Item 12 (notification preferences) is explicitly optional ("only needed if agents should control notifications") — NOT in this plan; leave for an owner decision.
- Items 7 (multi-plan same-start) and 9 (migration baseline) from the handoff are marked done/handled-by-runbook — not in scope.
