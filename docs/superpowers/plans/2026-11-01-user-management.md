# Super-Admin User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner create departments, define roles (each granting a fixed set of admin areas), create staff logins, and assign each to a role — with staff able to sign in and every admin route/page enforcing their areas server-side.

**Architecture:** Repurpose the existing (inert) `StaffUser` stub. Add `Department` and `Role` tables; `Role` carries a JSON list of **area keys** from a fixed catalog; `StaffUser` gains `roleId` + own `approvalPin`. Staff authenticate through the existing admin cookie with `role: 'staff'`. The proxy's coarse gate admits `superadmin|staff`; a new `requirePermission(area)` guard enforces the specific area per route (reading the staffer's role fresh from the DB so revocation is immediate); `requireAdminArea()` covers shell-wide endpoints; `requireSuperAdmin()` stays on owner-only routes. Money approvals stay PIN-gated — staff set their own PIN.

**Tech Stack:** Next.js 16 App Router, Prisma + SQLite, next-auth v4 (admin cookie), bcryptjs, plain CSS (`admin.css`). Node `--test` + `tsx` for unit tests.

**Spec:** `docs/superpowers/specs/2026-11-01-user-management-design.md`

## Global Constraints

- **Authorization is server-side; the client only hides UI.** Every admin route derives the actor from the session and checks permission server-side.
- **Admin authorization keys on the exact `role` claim.** The three auth systems share `NEXTAUTH_SECRET`; an agent token in the admin cookie decodes fine and MUST be rejected. Only `role === 'superadmin'` or `role === 'staff'` may enter the admin area. (`.claude/rules/auth-security.md`.)
- **Permissions are read fresh from the DB per request** for staff — never trusted from the JWT — so suspending a staffer or archiving their role takes effect on the next request.
- **No new `any`/`as any`** in new code; `@ts-expect-error <reason>` if unavoidable. `npx tsc --noEmit` is the type gate (baseline: 23 pre-existing errors — leave at ≤23).
- **No hardcoded secret fallbacks.** Read `NEXTAUTH_SECRET` via `requireEnv`.
- Audit every create/update/archive/assign/suspend/login with `logAudit` (`AuditLog` is append-only).
- Prisma datasource is hardcoded `file:./dev.db`; migrations are forward-only (never edit an applied migration; a hook blocks `migrate reset` / `db push --accept-data-loss`).
- Money type is `Float`; round with `money()` when comparing/displaying.
- Plain CSS matching `admin.css`; every screen works at ~360px (Flutter WebViews); every data view handles loading/empty/error.
- Secrets never logged or returned: never emit a password hash, PIN, or token.

## Review Focus

- **Cross-system token confusion:** an agent/customer NextAuth or jose token placed in the admin cookie must never pass as `staff`. → Tested in Task 1 (`isAdminAreaRole` rejects `agent`/`subagent`/`customer`/unknown) and Task 3 (guard denies non-admin roles).
- **Stale authorization:** a staffer suspended, or whose role is archived or had an area removed, must be denied on the **next** request. → Task 1 `decideAdminAccess` (suspended staff / archived role / missing area → deny) + Task 3 (guard re-reads DB every call).
- **Money action with no second factor:** a staffer granted a money area but with no PIN set must get a clear 403, not a 500 or a silent bypass. → Task 5 (`verifyApprovalPin` resolves staff PIN; no-PIN → existing 403 message).
- **Privilege via bad input:** creating/editing a role with unknown or non-string area keys must store nothing unknown (no made-up permission grants a real area by typo). → Task 1 `parsePermissions` (filters to known keys) + Task 8 (role create/update validates & rejects).
- **Deep-link bypass:** a staffer hitting a forbidden admin API directly must get 403 (not data); a forbidden page must show a no-access view. → Task 3 (API guard) + Task 11 (page nav-filter + no-access).

---

### Task 1: Permission catalog + pure authorization logic

**Files:**
- Create: `src/lib/permissions.ts`
- Test: `tests/permissions.test.ts`

**Interfaces:**
- Produces:
  - `AREA_KEYS` (readonly tuple) = `['agents','customers','loans','money','cards','oversight']`
  - `type Area = typeof AREA_KEYS[number]`
  - `MONEY_AREAS: readonly Area[]` = `['agents','customers','loans','money']`
  - `AREA_LABELS: Record<Area, string>` and `AREA_UNLOCKS: Record<Area, string>` (short human text for the UI, money actions noted)
  - `parsePermissions(raw: string | null | undefined): Area[]` — JSON-parse, keep only strings that are valid `Area` keys, dedupe; malformed/`null` → `[]`
  - `hasArea(perms: Area[], area: Area): boolean`
  - `isAdminAreaRole(role: unknown): boolean` — `true` only for `'superadmin'` or `'staff'`
  - `type AccessDecision = 'allow' | 'deny-401' | 'deny-403'`
  - `decideAdminAccess(input: { role: unknown; area: Area | null; staffStatus?: string | null; roleStatus?: string | null; rolePerms?: Area[] | null }): AccessDecision` — pure core used by the guards:
    - no/empty `role` → `deny-401`
    - `role === 'superadmin'` → `allow` (bypass, ignores `area`)
    - `role === 'staff'`: `deny-403` unless `staffStatus === 'Active'` AND (`area === null` baseline → allow) AND for a concrete `area`: `roleStatus === 'Active'` and `hasArea(rolePerms ?? [], area)`; else `deny-403`
    - any other role → `deny-403`

- [ ] **Step 1: Write the failing tests** `tests/permissions.test.ts`

```ts
// parsePermissions
assert.deepEqual(parsePermissions('["agents","money"]'), ['agents','money'])
assert.deepEqual(parsePermissions('["agents","agents","bogus",5]'), ['agents']) // unknown + non-string + dedupe
assert.deepEqual(parsePermissions('not json'), [])
assert.deepEqual(parsePermissions(null), [])
// hasArea
assert.equal(hasArea(['agents'], 'agents'), true)
assert.equal(hasArea(['agents'], 'money'), false)
// isAdminAreaRole
for (const r of ['superadmin','staff']) assert.equal(isAdminAreaRole(r), true)
for (const r of ['agent','subagent','customer','',null,undefined,'STAFF']) assert.equal(isAdminAreaRole(r), false)
// decideAdminAccess
assert.equal(decideAdminAccess({ role: null, area: 'agents' }), 'deny-401')
assert.equal(decideAdminAccess({ role: 'superadmin', area: 'money' }), 'allow')
assert.equal(decideAdminAccess({ role: 'staff', area: null, staffStatus: 'Active' }), 'allow') // baseline
assert.equal(decideAdminAccess({ role: 'staff', area: 'agents', staffStatus: 'Active', roleStatus: 'Active', rolePerms: ['agents'] }), 'allow')
assert.equal(decideAdminAccess({ role: 'staff', area: 'agents', staffStatus: 'Active', roleStatus: 'Active', rolePerms: ['customers'] }), 'deny-403') // area not granted
assert.equal(decideAdminAccess({ role: 'staff', area: 'agents', staffStatus: 'Suspended', roleStatus: 'Active', rolePerms: ['agents'] }), 'deny-403') // suspended
assert.equal(decideAdminAccess({ role: 'staff', area: 'agents', staffStatus: 'Active', roleStatus: 'Archived', rolePerms: ['agents'] }), 'deny-403') // archived role
assert.equal(decideAdminAccess({ role: 'staff', area: 'agents', staffStatus: 'Active', roleStatus: 'Active', rolePerms: null }), 'deny-403') // no role assigned
assert.equal(decideAdminAccess({ role: 'agent', area: 'agents' }), 'deny-403')
```

- [ ] **Step 2: Run** `NEXTAUTH_SECRET=test npx tsx --test tests/permissions.test.ts` → FAIL (module missing)
- [ ] **Step 3: Implement** `src/lib/permissions.ts` with the interfaces above. Pure; no imports from Prisma or next-auth.
- [ ] **Step 4: Run** the test → PASS
- [ ] **Step 5: Commit** `feat(admin): permission catalog + pure authorization core`

---

### Task 2: Schema — Department, Role, StaffUser additions + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_user_management/migration.sql` (generated by `migrate dev`)

**Interfaces:**
- Produces (Prisma models later tasks consume):
  - `model Department { id String @id @default(cuid()); name String @unique; description String?; status String @default("Active"); createdAt DateTime @default(now()); roles Role[] }`
  - `model Role { id String @id @default(cuid()); departmentId String; department Department @relation(fields:[departmentId], references:[id]); name String; permissions String @default("[]"); status String @default("Active"); createdAt DateTime @default(now()); staff StaffUser[]; @@unique([departmentId, name]) }`
  - `StaffUser` gains: `roleId String?`, `role_ Role? @relation(fields:[roleId], references:[id])` **(see note)**, `approvalPin String?`. **Keep** the legacy `role`/`permissions` columns for now (retired in a later drop migration) — new code stops writing them.

> **Builder note on the `role` name clash:** `StaffUser` already has a scalar column named `role`. Prisma can't have a relation field also named `role`. Name the new relation field `roleRef` (or `assignedRole`) mapping `roleId`. Pick one and use it consistently in Tasks 3/8/9. Document the choice in the ledger.

- [ ] **Step 1:** Add the two models and the three `StaffUser` fields to `schema.prisma`.
- [ ] **Step 2:** Run `npx prisma validate` → OK.
- [ ] **Step 3:** Run `npx prisma migrate dev --name add_user_management` (creates migration + applies to dev.db), then `npx prisma generate`.
- [ ] **Step 4: Verify** the migration SQL adds the two tables and the `StaffUser` columns and does **not** drop or rewrite existing columns (`grep` the generated SQL; it must be `CREATE TABLE "Department"`, `CREATE TABLE "Role"`, and `ALTER TABLE "StaffUser" ADD COLUMN`). If `migrate dev` wants to recreate `StaffUser` (SQLite table-rebuild), confirm it preserves all existing columns and data.
- [ ] **Step 5: Commit** `feat(admin): Department/Role schema + StaffUser roleId & approvalPin`

---

### Task 3: Server guards — `requirePermission` + `requireAdminArea`

**Files:**
- Modify: `src/lib/admin-guard.ts`
- Test: `tests/admin-guard.test.ts`

**Interfaces:**
- Consumes: `decideAdminAccess`, `parsePermissions`, `type Area` (Task 1); Prisma `StaffUser`→`roleRef`→permissions (Task 2).
- Produces:
  - `type AdminGuard = { ok: true; session: Session; actor: { id?: string; name: string; type: 'superadmin' | 'staff' } } | { ok: false; response: NextResponse }`
  - `async function requirePermission(area: Area): Promise<AdminGuard>`
  - `async function requireAdminArea(): Promise<AdminGuard>` (passes `area: null` to the core)
  - Keep `requireSuperAdmin()` and `adminActor()` as-is.
  - Extract the session→decision wiring into one internal `async function resolveAdminAccess(area: Area | null)` that: gets the session; if `role === 'staff'` loads the StaffUser (`select id,name,status, roleRef:{select:{status,permissions}}`) by `session.user.id`; builds the `decideAdminAccess` input; maps `allow`→`{ok, actor}`, `deny-401`→401, `deny-403`→403.

- [ ] **Step 1: Write failing tests** `tests/admin-guard.test.ts` — unit-test `resolveAdminAccess` by injecting a fake session-getter and a fake StaffUser loader (export them as injectable params or via a small `deps` object so no real `getServerSession`/Prisma is needed). Assert: superadmin→allow; active staff w/ area→allow; suspended staff→403; archived role→403; staff w/ no role→403; agent role→403; no session→401; `requireAdminArea` path (area null) allows active staff w/ no matching area.

> If injecting deps is impractical, keep the DB/session wiring in the guard and unit-test the already-pure `decideAdminAccess` (Task 1) exhaustively instead; then this task's test asserts the *mapping* (`allow`→ok, `deny-401`→401 body `{error:'Unauthorized'}`, `deny-403`→403 body `{error:'Forbidden'}`) using a thin wrapper. Choose one; record the choice.

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** the guards.
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit` ≤ baseline.
- [ ] **Step 5: Commit** `feat(admin): requirePermission + requireAdminArea guards`

---

### Task 4: Staff login (custom route + NextAuth provider)

**Files:**
- Modify: `src/app/api/admin-auth/login/route.ts`
- Modify: `src/lib/auth-admin.ts`
- Test: `tests/admin-login-identity.test.ts`

**Interfaces:**
- Consumes: Prisma `SuperAdmin`, `StaffUser` (status `Active`).
- Produces: a signed admin cookie with claims `{ sub, email, name, role: 'staff' | 'superadmin', loginAt }`. Staff token's `sub` = staff id (so `session.user.id` is populated for audit + PIN).
- Behaviour contract (both files identical):
  1. Look up `SuperAdmin` by lower-cased email. If found → verify password → ok ⇒ superadmin token; bad password ⇒ 401 (`auth-admin`: return null). **Do not** fall through to staff.
  2. Else look up `StaffUser` by email. If found AND `status === 'Active'` AND password matches → staff token (and set `lastActiveAt = now`). Else → 401/null.
- Extract the branch choice into a pure helper to unit-test: `pickIdentity(opts: { superAdmin: {id:string;name:string;email:string} | null; staff: {id:string;name:string;email:string;status:string} | null }): { kind:'superadmin'|'staff'|'none'; id?:string; name?:string; email?:string }` — superadmin present ⇒ 'superadmin' (even before password check path); staff present & Active ⇒ 'staff'; staff present & not Active ⇒ 'none'; neither ⇒ 'none'. (Password comparison stays in the route; `pickIdentity` only decides which record the password is checked against / which token to mint.)

- [ ] **Step 1: Write failing tests** `tests/admin-login-identity.test.ts` for `pickIdentity`: superadmin wins over staff; active staff when no superadmin; suspended staff ⇒ none; neither ⇒ none.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** `pickIdentity` (in `src/lib/admin-identity.ts`, pure), then wire both the custom route and `auth-admin.ts authorize()` to use it; mint the correct token/role; stamp `loginAt`; audit the login (`actorType` `'staff'` for staff). Staff login updates `lastActiveAt`.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(admin): authenticate StaffUser through the admin login`

---

### Task 5: Role-aware approval PIN + staff self-service PIN/password

**Files:**
- Modify: `src/lib/approval-pin.ts`
- Create: `src/app/api/admin/me/approval-pin/route.ts` (POST — set own PIN)
- Create: `src/app/api/admin/me/password/route.ts` (POST — change own password)
- Test: `tests/approval-pin-owner.test.ts`

**Interfaces:**
- Consumes: `requireAdminArea` (Task 3); Prisma `SuperAdmin`/`StaffUser`.
- Produces:
  - `verifyApprovalPin(session, pin)` becomes role-aware: resolve the PIN record + id from `StaffUser` when `session.user.role === 'staff'`, else `SuperAdmin` (unchanged logic otherwise — attempt counter keyed on the resolved id via the existing `ApprovalPinAttempt.adminId` string). No-PIN-set ⇒ existing 403 message. Extract `resolvePinOwner(role: unknown): 'staff' | 'superadmin'` (pure) for the branch.
  - `/api/admin/me/approval-pin` POST `{ pin, currentPassword }`: `requireAdminArea`; verify current password against the actor's own record; set `approvalPin` on the actor's own row (StaffUser or SuperAdmin); audit. Min 4 digits.
  - `/api/admin/me/password` POST `{ currentPassword, newPassword }`: `requireAdminArea`; verify current; set `password` on the actor's own row; audit. Min length per existing conventions.

- [ ] **Step 1: Write failing test** `tests/approval-pin-owner.test.ts` for `resolvePinOwner`: `'staff'`→`'staff'`; `'superadmin'`/`undefined`/anything-else→`'superadmin'`.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** `resolvePinOwner`, make `verifyApprovalPin` role-aware, add the two self-service routes.
- [ ] **Step 4: Run** → PASS; `tsc` ≤ baseline.
- [ ] **Step 5: Commit** `feat(admin): role-aware approval PIN + staff self-service PIN/password`

---

### Task 6: Proxy admits valid staff sessions

**Files:**
- Modify: `src/proxy.ts`
- Test: `tests/proxy-admin-role.test.ts` (unit the role predicate usage)

**Interfaces:**
- Consumes: `isAdminAreaRole` (Task 1).
- Change: replace `adminIsSuper` with `adminIsAdminArea = isAdminAreaRole(adminRole)`. Admin API: `!adminValid`→401, `!adminIsAdminArea`→403. Superadmin pages: redirect to `/superadmin/login` when `adminValid && !adminIsAdminArea`. (Per-area enforcement stays in the route guards; the proxy only gates admin-area membership + expiry.)

- [ ] **Step 1: Write failing test** asserting `isAdminAreaRole` gives the gate behaviour the proxy needs: `superadmin`/`staff`→admitted, `agent`/`subagent`/`customer`/unknown→rejected. (If the proxy itself is hard to unit-test, assert the predicate — it is the whole decision — and keep the proxy edit a one-line swap.)
- [ ] **Step 2: Run** → FAIL (or trivially covered by Task 1; then this task is the wiring + a regression note)
- [ ] **Step 3: Implement** the proxy swap.
- [ ] **Step 4: Run** full unit suite → PASS; confirm no other proxy behaviour changed.
- [ ] **Step 5: Commit** `feat(admin): proxy admits valid staff sessions (per-area enforced downstream)`

---

### Task 7: Remap every admin API route to its area guard (batch)

**Files (modify — swap the guard import + call only; no other logic changes):**
Map each route's `requireSuperAdmin()` to the guard below. **Owner-only routes keep `requireSuperAdmin()`.** This is one batched dispatch; review as a single diff.

| Guard | Routes (under `src/app/api/`) |
|---|---|
| `requirePermission('agents')` | `admin/agents/**`, `admin/agent-withdrawal/**`, `admin/commission/**`, `admin/rewards/**`, `superadmin/agent-invite`, `superadmin/agents/[id]/documents/approve` |
| `requirePermission('customers')` | `admin/customers/**`, `admin/savings`, `admin/savings-interest`, `admin/interest-rates`, `admin/early-redemption/**`, `admin/redemptions` |
| `requirePermission('loans')` | `admin/loans/**`, `admin/loan-disbursements`, `admin/loan-repayments` |
| `requirePermission('money')` | `admin/transactions`, `admin/payout-mode`, `admin/wallets/**` |
| `requirePermission('cards')` | `admin/cards/**` |
| `requirePermission('oversight')` | `admin/devices`, `admin/audit`, `admin/reports/**` |
| `requireAdminArea()` | `admin/stats` |
| `requireSuperAdmin()` (unchanged) | `admin/staff/**`, `admin/set-approval-pin`, `admin/departments/**` (Task 8), `admin/roles/**` (Task 8), `admin/me/**` uses `requireAdminArea` (Task 5) |

- [ ] **Step 1:** For each route, replace the `requireSuperAdmin` import/call with the mapped guard. Where a handler used `guard.session` only for `adminActor`/audit, switch to `guard.actor` (now provided by `requirePermission`/`requireAdminArea`). Leave all business logic untouched.
- [ ] **Step 2:** `npx tsc --noEmit` ≤ baseline; run full unit suite (unchanged logic ⇒ still green).
- [ ] **Step 3: Verify** no `requireSuperAdmin` remains on a non-owner route: `grep -rl requireSuperAdmin src/app/api` should list only the owner-only set above.
- [ ] **Step 4: Commit** `feat(admin): enforce per-area permissions on all admin API routes`

---

### Task 8: Departments & Roles API (owner-only)

**Files:**
- Create: `src/app/api/admin/departments/route.ts` (GET list w/ role counts; POST create `{name, description?}`)
- Create: `src/app/api/admin/departments/[id]/route.ts` (PATCH `{name?, description?, status?}` — rename/archive; block archive is a soft status flip)
- Create: `src/app/api/admin/roles/route.ts` (GET list w/ department + staff counts; POST create `{departmentId, name, permissions: Area[]}`)
- Create: `src/app/api/admin/roles/[id]/route.ts` (PATCH `{name?, permissions?, status?}`)
- Test: `tests/role-permissions-validate.test.ts`

**Interfaces:**
- Consumes: `requireSuperAdmin`, `parsePermissions`/`AREA_KEYS` (Task 1), Prisma `Department`/`Role` (Task 2).
- All five handlers `requireSuperAdmin()`. Validate: non-empty names; `departmentId` exists; **permissions filtered through `parsePermissions` and rejected if any submitted key is unknown** (don't silently drop — 400 with the offending keys, so a typo never quietly under-grants). Store `JSON.stringify(validAreas)`. Audit each mutation. Archiving (not deleting) is the retire path; a department/role with dependents cannot be hard-deleted (no DELETE endpoint in v1 — status flip only).

- [ ] **Step 1: Write failing test** `tests/role-permissions-validate.test.ts` for a pure `validateRolePermissions(input: unknown): { ok: true; areas: Area[] } | { ok: false; unknown: string[] }` (put it in `src/lib/permissions.ts`): all-valid→ok w/ deduped areas; contains `'bogus'`→`{ok:false, unknown:['bogus']}`; non-array→`{ok:false}`.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** `validateRolePermissions` then the four route files using it.
- [ ] **Step 4: Run** → PASS; `tsc` ≤ baseline.
- [ ] **Step 5: Commit** `feat(admin): departments & roles CRUD (owner-only, validated permissions)`

---

### Task 9: Staff API rework (assign role, expose department + PIN status)

**Files:**
- Modify: `src/app/api/admin/staff/route.ts` (GET + POST)
- Modify: `src/app/api/admin/staff/[id]/route.ts` (PATCH + DELETE)

**Interfaces:**
- Consumes: `requireSuperAdmin`, Prisma `StaffUser`/`roleRef`/`department` (Task 2).
- POST create: `{ name, email, password, roleId? }` — stop writing the legacy `role`/`permissions`; set `roleId` when provided. Keep the existing `findIdentityConflict` email check.
- PATCH: accept `{ roleId?, status? }` (assign/reassign role, suspend/reactivate). Stop accepting legacy `role`/`permissions`.
- GET: return per staffer `{ id, name, email, status, lastActiveAt, createdAt, role: roleRef && { id, name, department:{id,name} } | null, hasApprovalPin: boolean }` — `hasApprovalPin` = `approvalPin != null` (never return the hash).

- [ ] **Step 1:** Update POST/PATCH/GET as above. (No new pure logic; covered by Task 1/3 tests + the final review. If extracting a selector helper, add a small shape test.)
- [ ] **Step 2:** `npx tsc --noEmit` ≤ baseline; full unit suite green.
- [ ] **Step 3: Commit** `feat(admin): staff API assigns roles, exposes department + PIN status`

---

### Task 10: UI — Staff & access (Departments / Roles / People)

**Files:**
- Modify: `src/app/superadmin/staff/page.tsx` (rework into three tabbed views)
- (Optionally extract shared bits into `src/app/superadmin/staff/_components/*` if the file grows unwieldy.)

**Interfaces:**
- Consumes: `/api/admin/departments`, `/api/admin/roles`, `/api/admin/staff`, and `AREA_LABELS`/`AREA_UNLOCKS`/`MONEY_AREAS` (Task 1) for the role editor.
- Three views (segmented control, matching existing admin.css patterns):
  1. **Departments** — list (name, description, #roles, status), create, rename, archive.
  2. **Roles** — pick a department, list its roles; create/edit a role: name + a checklist of the six areas using `AREA_LABELS`, each showing `AREA_UNLOCKS`, money areas (`MONEY_AREAS`) visibly flagged (e.g. a "handles money" chip). Archive a role.
  3. **People** — create a staff login (name, email, initial password, assign role), list (name, email, department·role, status, `hasApprovalPin` indicator, last active), suspend/reactivate, remove, reset handled by owner re-issuing a password via PATCH… (password reset: keep v1 to suspend+recreate OR a simple "set new password" PATCH — builder's call; if added, route it through `staff/[id]` PATCH with `password`).
- Replace the "can't sign in yet" banner with real copy.
- Every view handles loading/empty/error; works at 360px.

- [ ] **Step 1:** Build the three views against the Task 8/9 APIs.
- [ ] **Step 2:** Manually verify (dev) create department → role → staff; `tsc` ≤ baseline.
- [ ] **Step 3: Commit** `feat(admin): departments/roles/people management UI`

---

### Task 11: UI — nav filtering, no-access view, self-service controls, resilient home

**Files:**
- Modify: `src/app/superadmin/_components/AdminShell.tsx` (filter nav groups to the signed-in staffer's areas; redirect/no-access on forbidden deep-links)
- Modify: `src/app/superadmin/page.tsx` (home dashboard degrades: tiles whose endpoint 403s are hidden/empty, never a crash)
- Create: a small `useMyAccess()` client hook that fetches the signed-in actor's role/areas (new tiny endpoint `GET /api/admin/me` → `{ role: 'superadmin' | 'staff', areas: Area[] }`, `requireAdminArea`), plus a reusable "No access to this area" panel.
- Add self-service controls (change password; set approval PIN if the staffer's areas intersect `MONEY_AREAS`) in the admin account menu, calling the Task 5 `me/*` routes.

**Interfaces:**
- Consumes: Task 1 `AREA_KEYS`/`Area`/`MONEY_AREAS`; Task 5 `me/*`; new `GET /api/admin/me`.
- Nav groups map to areas: Agents→`agents`, Customers→`customers`, Loans→`loans`, Money→`money`, Cards→`cards`, Oversight→`oversight`. The **Staff & access** item shows only for `superadmin`. Superadmin sees everything (no filtering).
- Filtering is cosmetic; the server guards remain the boundary. A staffer who deep-links a hidden page sees the no-access panel (client), and its data fetches 403 regardless.

- [ ] **Step 1:** Add `GET /api/admin/me`; build `useMyAccess()`, nav filtering, the no-access panel, the resilient home, and the self-service controls.
- [ ] **Step 2:** Manually verify (dev) as a staffer with a single area: nav shows only that group; deep-linking another area shows no-access; its API returns 403; a money-area staffer can set a PIN and then approve.
- [ ] **Step 3:** `tsc` ≤ baseline; full unit suite green.
- [ ] **Step 4: Commit** `feat(admin): staff-aware nav, no-access view, self-service PIN/password`
