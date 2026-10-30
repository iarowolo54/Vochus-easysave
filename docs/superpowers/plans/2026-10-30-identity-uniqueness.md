# One Identity, One Account — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone number or email may belong to exactly one account across the whole system (Customer, Agent, SubAgent, SuperAdmin, StaffUser), enforced at every account-creation path going forward.

**Architecture:** A shared helper normalizes an incoming phone/email and compares it — normalized in application code — against the identities already in all five account tables (small data set), returning the first conflicting field. Every create route calls it and returns 409 on a conflict. Existing duplicates are grandfathered (no migration, no deletion). Customer phone/email are additionally stored normalized going forward.

**Tech Stack:** Next.js App Router route handlers, Prisma + SQLite, `node:test` via `tsx` (`NEXTAUTH_SECRET=test npx tsx --test tests/<file>`).

**Spec:** `docs/superpowers/specs/2026-10-30-savings-features-design.md` (Feature 2 section)

## Global Constraints

- Enforcement is **application-level only**. Do NOT add a `@unique` to `Customer.phone`/`email` or any cross-table DB constraint, and do NOT write a data migration — the prod DB already has grandfathered duplicates that such a migration would fail on or destroy.
- **Grandfather existing data:** never delete, merge, or reformat existing rows. Only *new* creations are blocked.
- **Normalize both sides in app code.** Incoming and stored values are both normalized before comparison, because existing rows are stored raw (SQLite `=` is case-sensitive and can't fold `+234`).
- Phone canonical form: `0` + 10 digits (`^0\d{10}$`). Email canonical: `trim().toLowerCase()` (reuse `normalizeEmail` from `src/lib/email.ts`).
- **Error copy (verbatim):** `"This phone number is already registered."` / `"This email is already registered."` Status **409**. Do NOT reveal which role/account owns it (no enumeration).
- No new `any`/`as any`; use `unknown` + narrowing. `npx tsc --noEmit` must not regress the **23-error baseline**. Leave each touched file no worse.
- Do not disturb the `ui/zopa-standard` redesign. This branch is based on **latest `main`**.

## Review Focus

- **`+234`/`234…` phone form vs stored `0…`** — a new signup using `+2348012345678` must be detected as the same as an existing `08012345678`. (Task 1 + Task 2 tests.)
- **Grandfathered email stored raw-cased** (`John@X.com`) vs new `john@x.com` — must be detected despite the raw stored casing. (Task 2 test seeds a raw-cased row.)
- **Missing/empty email (nullable)** — a signup with no email must be allowed and must NOT collide with other null/empty emails. (Task 2 test.)
- **Cross-table reuse** — a phone/email already on an Agent must block a new Customer (and vice-versa). (Task 2 test.)
- **Programmatic agent creation** (`src/lib/gift-card-house.ts`) — must not be bricked by the guard if it uses synthetic identifiers. (Task 4 decides and tests/▲documents.)

---

### Task 1: `normalizePhone` pure helper

**Files:**
- Create: `src/lib/phone.ts`
- Test: `tests/phone.test.ts`

**Interfaces:**
- Produces: `normalizePhone(raw: string): string` — trims, strips spaces and dashes, folds a leading `+234` or a 13-digit `234…` to `0`, and returns the result. Non-matching input is returned trimmed/stripped unchanged (the caller still validates shape).

- [ ] **Step 1: Write the failing test** in `tests/phone.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone } from '../src/lib/phone.ts'

test('keeps canonical 0-form unchanged', () => {
  assert.equal(normalizePhone('08012345678'), '08012345678')
})
test('folds +234 to 0', () => {
  assert.equal(normalizePhone('+2348012345678'), '08012345678')
})
test('folds 13-digit 234 to 0', () => {
  assert.equal(normalizePhone('2348012345678'), '08012345678')
})
test('strips spaces and dashes', () => {
  assert.equal(normalizePhone(' 0801-234 5678 '), '08012345678')
})
test('does not fold a 234-prefixed local number of wrong length', () => {
  assert.equal(normalizePhone('2340'), '2340')
})
```

- [ ] **Step 2: Run test to verify it fails** — `NEXTAUTH_SECRET=test npx tsx --test tests/phone.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `normalizePhone(raw: string): string` in `src/lib/phone.ts`.** Strip whitespace/dashes first, then fold `+234` (and a `234` prefix only when the stripped string is 13 digits) to `0`.
- [ ] **Step 4: Run test to verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/phone.ts tests/phone.test.ts && git commit -m "feat(identity): add normalizePhone helper"`

---

### Task 2: `findIdentityConflict` cross-account helper

**Files:**
- Create: `src/lib/identity.ts`
- Test: `tests/identity.int.test.ts`

**Interfaces:**
- Consumes: `normalizePhone` (Task 1), `normalizeEmail` (`src/lib/email.ts`), the shared Prisma client (`src/lib/prisma.ts`) — but the function takes the client as a parameter so the test can pass the real `prisma`.
- Produces:
  `findIdentityConflict(client, input: { phone?: string | null; email?: string | null }, opts?: { excludeCustomerId?: string }): Promise<'phone' | 'email' | null>`
  — returns `'phone'` if the normalized phone matches any existing account (checked first), else `'email'` if the normalized email matches, else `null`. Null/empty inputs for a field are skipped (never match). `excludeCustomerId` omits that one Customer row (for future edit flows).

- [ ] **Step 1: Write the failing integration test** in `tests/identity.int.test.ts`. Use the real `prisma`, create rows in a `beforeEach`/cleanup pattern consistent with the existing `*.int.test.ts` files, and assert:
  - phone already on an **Agent** → `'phone'` when a new customer uses the same number (cross-table).
  - email already on a **Customer stored raw-cased** (`Mix@Case.com`) → `'email'` for incoming `mix@case.com`.
  - incoming `+234` form matching a stored `0…` Agent phone → `'phone'`.
  - a brand-new, unused phone + email → `null`.
  - incoming `email: null` (no email) with another null-email customer present → not an `'email'` conflict.
  - `excludeCustomerId` set to a matching customer's id → that row is ignored.

- [ ] **Step 2: Run test to verify it fails** — `NEXTAUTH_SECRET=test npx tsx --test tests/identity.int.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `findIdentityConflict` in `src/lib/identity.ts`.** Query only the identity columns from the five tables (`customer.findMany({ select: { id, phone, email } })`, `agent` `{ phone, email }`, `subAgent` `{ phone }`, `superAdmin` `{ email }`, `staffUser` `{ email }`), normalize both sides in JS, compare. Check phone across {Customer, Agent, SubAgent} first; if no phone match, check email across {Customer, Agent, SuperAdmin, StaffUser}. Skip blank inputs. Honor `excludeCustomerId`.
- [ ] **Step 4: Run test to verify it passes** — same command → PASS. Then run the **full suite** (`NEXTAUTH_SECRET=test npx tsx --test tests/*.test.ts tests/*.int.test.ts` or the repo's test command) → all green.
- [ ] **Step 5: Commit** — `git add src/lib/identity.ts tests/identity.int.test.ts && git commit -m "feat(identity): add findIdentityConflict cross-account helper"`

---

### Task 3: Guard the customer-creation paths + store normalized

**Files:**
- Modify: `src/app/api/customers/route.ts:138` (agent enrols customer — currently **no** dup check)
- Modify: `src/app/api/customer/enroll/route.ts:96,128` (self-enrol — replace the phone-only check; add email)
- Test: `tests/customer-enroll-identity.int.test.ts`

**Interfaces:**
- Consumes: `findIdentityConflict` (Task 2), `normalizePhone` (Task 1), `normalizeEmail`.

- [ ] **Step 1: Write the failing integration test** in `tests/customer-enroll-identity.int.test.ts`. The self-enrol route authenticates via an invite/`aid` + a verified `emailOTP` row (not NextAuth), so it is callable directly: seed an existing customer with phone `08012345678`, seed a valid agent + a verified `emailOTP` for the new email, build a `Request` with a body reusing that phone, call the exported `POST`, and assert the response is **409** with body `error: 'This phone number is already registered.'`. Add a second case: an existing customer with email `taken@x.com` and a new signup (different phone, verified OTP) reusing that email → 409 `'This email is already registered.'`.
- [ ] **Step 2: Run test to verify it fails** — `NEXTAUTH_SECRET=test npx tsx --test tests/customer-enroll-identity.int.test.ts` → FAIL (today the route has no email check / returns a different phone message).
- [ ] **Step 3: Implement.**
  - In `customer/enroll/route.ts`: replace the `findFirst({ where: { phone } })` block (line ~96) with `const conflict = await findIdentityConflict(prisma, { phone, email })` **after** the email-OTP gate; return the matching 409 copy. Store normalized: `phone: normalizePhone(phone)`, `email: email ? normalizeEmail(email) : null` in the `create` data (line ~128).
  - In `customers/route.ts`: add the same `findIdentityConflict(prisma, { phone, email })` guard **immediately before** `prisma.customer.create` (line ~138), returning the 409 copy; store `phone: normalizePhone(phone)`, `email: email ? normalizeEmail(email) : null`.
- [ ] **Step 4: Run test to verify it passes** — same command → PASS; then full suite → green; then `npx tsc --noEmit` → still at the 23-error baseline (no new errors in touched files).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(identity): block duplicate phone/email on customer creation; store normalized"`

---

### Task 4: Guard the agent / sub-agent / staff creation paths

**Files:**
- Modify: `src/app/api/admin/agents/route.ts:98` (admin creates agent)
- Modify: `src/app/api/agent/onboard/[token]/route.ts:48` (agent self-onboard)
- Modify: `src/app/api/subagents/route.ts:42` (keep the P2002 catch as a backstop; add the pre-check)
- Modify: `src/app/api/admin/staff/route.ts:44`
- Investigate: `src/lib/gift-card-house.ts:10`
- Test: `tests/identity-guard-wiring.int.test.ts`

**Interfaces:**
- Consumes: `findIdentityConflict` (Task 2).

**Note on testing:** the behavioral logic is `findIdentityConflict`, fully tested in Task 2. These four routes are NextAuth-guarded thin adapters whose only new work is "call the helper, map a conflict to a 409" — mocking NextAuth sessions to drive them end-to-end costs far more than it proves. Per TDD's own "the design is what you test" exception, this task adds a regression assertion for the directions Task 2 did not cover, then verifies wiring by inspection + `tsc` + full suite, with real HTTP behavior proven in the staging smoke. State this honestly in the report; do not claim HTTP-level coverage that isn't there.

- [ ] **Step 1: Add a regression assertion** in `tests/identity-guard-wiring.int.test.ts` for the directions not asserted in Task 2: a **Customer** phone blocks a new **Agent** (`findIdentityConflict(prisma, { phone })` → `'phone'` with only a Customer seeded), and a **Customer** email collides on the **Staff/SuperAdmin** email direction (`{ email }` → `'email'`). Run it: `NEXTAUTH_SECRET=test npx tsx --test tests/identity-guard-wiring.int.test.ts` → PASS (guards Task 2's table coverage against regression). If it does NOT pass, Task 2 missed a table — fix Task 2.
- [ ] **Step 2: Wire the guard into each route.** Insert `const conflict = await findIdentityConflict(prisma, { phone, email })` (email omitted for sub-agent) immediately before each `create`, returning the exact 409 copy on `'phone'`/`'email'`; leave the existing `P2002 → 409` catches in place as a DB backstop. Files: `admin/agents/route.ts:98`, `agent/onboard/[token]/route.ts:48`, `subagents/route.ts:42`, `admin/staff/route.ts:44`.
- [ ] **Step 3: Decide `gift-card-house.ts`.** Read it; if it creates a real human-login agent from real contact details, add the guard; if it uses synthetic/placeholder identifiers (no real phone/email a person signs in with), **do not** guard it — add a one-line comment explaining why. Note the decision in the commit body.
- [ ] **Step 4: Verify.** Confirm by reading each route that the guard precedes the `create`. Run the full suite → green; `npx tsc --noEmit` → still at the 23-error baseline (no new errors in touched files).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(identity): block cross-account duplicate phone/email on agent/subagent/staff creation"`

---

## Rollout (after all tasks, not a build step)

- Deploy to **staging** (`./scripts/deploy-staging.sh`), then smoke the NextAuth-guarded routes manually: try to create an agent/customer reusing an existing phone and an existing email → expect 409 with the exact copy; create with a fresh identity → success.
- Deploy to **prod** (clean `./scripts/deploy.sh`, user approves in the UI).
- No DB migration ships with this feature (app-level only).
