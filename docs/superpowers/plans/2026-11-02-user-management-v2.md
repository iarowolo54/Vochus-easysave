# User Management v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the just-built v1 user-management feature into per-screen view/manage permissions, add department leads with bounded delegated management, add an invite-link set-password flow, and merge department+role creation into one flow.

**Architecture:** Builds on the v1 branch `feature/user-management` (held, unmerged). v1 plumbing is reused unchanged: staff authenticate through the admin login, authorization is read fresh from the DB every request (immediate revocation), audit attributes to the acting actor, the approval-PIN flow, the fail-closed nav. v2 replaces the 6-area catalog with per-screen `screen:action` permissions enforced per route handler, adds `Department.leadId` + `StaffUser.departmentId` for bounded lead delegation, and replaces owner-set passwords with crypto invite tokens.

**Tech Stack:** Next.js 16 App Router, Prisma + SQLite, next-auth v4 (admin cookie), bcryptjs, `node:crypto`, `sendMail` (`src/lib/mail.ts`), plain CSS (`admin.css`). Node `--test` + `tsx` for unit tests.

**Spec:** `docs/superpowers/specs/2026-11-01-user-management-v2-delta.md` (extends `…-user-management-design.md`).

## Global Constraints
- **Authorization is server-side; the client only hides UI.** Every admin route handler derives the actor from the session and checks permission server-side.
- **Authorization keys on the exact `role` claim** (`superadmin`|`staff`); agent/customer tokens in the admin cookie must be rejected. Staff permissions, lead status, and department membership are read **fresh from the DB per request** — never trusted from the JWT.
- **manage implies view** everywhere a permission is checked; stored role perms are normalized so every `screen:manage` carries `screen:view`.
- **Lead delegation is bounded:** a lead may only act within their own department, may only grant permissions within their own (normalized) ceiling, and may never appoint/remove a lead, create/archive departments, or move staff across departments.
- **Invite tokens:** generate with `node:crypto` (not `Math.random`); store only a SHA-256 hash; single-use; 48 h expiry; never logged; attempt-capped on the resolved staff id.
- **No new `any`/`as any`** in new code; `@ts-expect-error <reason>` only if unavoidable. Type gate `npx tsc --noEmit` must stay at the 23-error baseline.
- **No hardcoded secret fallbacks** (`requireEnv`). Audit every mutation with `logAudit` (append-only); never log/return a password, PIN, hash, or token.
- Prisma datasource hardcoded `file:./dev.db`; migrations forward-only (hook blocks `migrate reset`/`db push --accept-data-loss`). Plain CSS matching `admin.css`; every screen works at ~360px; every data view handles loading/empty/error.
- Test command (unit): `NEXTAUTH_SECRET=test npx tsx --test $(ls tests/*.test.ts | grep -v '\.int\.test\.ts$')`.

## Review Focus
- **Lead privilege escalation** — a lead grants beyond their ceiling, edits/launders a role above their ceiling, acts on another department, moves staff across departments, or appoints a lead. → Task 1 (`canGrant`), Task 3 (`requireDeptManage`), Task 8 (role create/edit bound), Task 9 (staff dept-scoping).
- **Per-handler enforcement gaps** — a mutating handler gated only on `:view` or nothing; a view-only screen allowing mutation. → Task 7 (per-handler remap + grep/verify), Task 3 (`hasPermission`).
- **Invite-token abuse** — predictable/un-hashed/reusable/expired-accepted tokens; re-opening an Active account; unthrottled wrong submissions; token in logs. → Task 5.
- **Login gating** — `Invited`/`Suspended`/null-password staff authenticating. → Task 4.
- **Stale lead** — a suspended/moved/role-stripped lead keeping lead powers because `leadId` still points at them. → Task 3.

---

### Task 1: Permission catalog v2 + pure authorization core

**Files:**
- Rewrite: `src/lib/permissions.ts`
- Rewrite: `tests/permissions.test.ts`

**Interfaces — Produces:**
- `SCREENS`: readonly catalog; each entry `{ key, label, group, actions: ('view'|'manage')[], handlesMoney?: boolean, manageNote?: string }`. Keys/groups/view-only set per the delta's screen table (view-only: `agent-wallets`, `transactions`, `audit`, `reports`).
- `type ScreenKey`, `type Action = 'view'|'manage'`, `type Perm = \`${ScreenKey}:${Action}\``.
- `MONEY_SCREENS: readonly ScreenKey[]`.
- `parsePermissions(raw): Perm[]` — JSON-parse, keep only valid `Perm` tokens, **normalize** (every `x:manage` implies `x:view`), dedupe; malformed/null → `[]`.
- `hasPermission(perms: Perm[], screen: ScreenKey, action: Action): boolean` — `view` satisfied by `x:view` or `x:manage`; `manage` only by `x:manage`.
- `validateRolePermissions(input): { ok:true; perms:Perm[] } | { ok:false; unknown:string[] }` — reject unknown/non-string tokens (name them); on ok return normalized deduped `Perm[]`.
- `canGrant(granter: Perm[], requested: Perm[]): boolean` — true iff every `requested` token ∈ normalized `granter`.
- `isAdminAreaRole(role): boolean` (unchanged from v1).
- `type AccessDecision = 'allow'|'deny-401'|'deny-403'`.
- `decideAdminAccess(input: { role; screen: ScreenKey|null; action?: Action; staffStatus?; roleStatus?; rolePerms?: Perm[]|null }): AccessDecision` — superadmin→allow; falsy role→deny-401; staff needs `staffStatus==='Active'`, and for a concrete screen `roleStatus==='Active'` + `hasPermission(rolePerms??[], screen, action??'view')`; `screen===null`→baseline allow for Active staff; other role→deny-403.

- [ ] **Step 1: Write failing tests** `tests/permissions.test.ts`:
```ts
// normalize + parse
assert.deepEqual(parsePermissions('["redemptions:manage"]').sort(), ['redemptions:manage','redemptions:view'])
assert.deepEqual(parsePermissions('["x:bogus","audit:manage",5]'), []) // unknown action/screen + non-string dropped (audit has no manage)
assert.deepEqual(parsePermissions('nope'), [])
// hasPermission (manage implies view)
assert.equal(hasPermission(['redemptions:manage'],'redemptions','view'), true)
assert.equal(hasPermission(['redemptions:view'],'redemptions','manage'), false)
// validateRolePermissions
assert.deepEqual(validateRolePermissions(['customers:view']), {ok:true, perms:['customers:view']})
assert.equal(validateRolePermissions(['nope:view']).ok, false)
assert.equal(validateRolePermissions('x').ok, false)
// canGrant (normalized ceiling)
assert.equal(canGrant(['customers:manage'], ['customers:view']), true)   // manage ceiling grants view
assert.equal(canGrant(['customers:view'], ['customers:manage']), false)  // view ceiling can't grant manage
assert.equal(canGrant(['customers:manage'], ['treasury:view']), false)
// decideAdminAccess
assert.equal(decideAdminAccess({role:'superadmin', screen:'treasury', action:'manage'}), 'allow')
assert.equal(decideAdminAccess({role:'staff', screen:'redemptions', action:'manage', staffStatus:'Active', roleStatus:'Active', rolePerms:['redemptions:view']}), 'deny-403')
assert.equal(decideAdminAccess({role:'staff', screen:'redemptions', action:'view', staffStatus:'Active', roleStatus:'Active', rolePerms:['redemptions:manage']}), 'allow')
assert.equal(decideAdminAccess({role:'staff', screen:null, staffStatus:'Active'}), 'allow')
assert.equal(decideAdminAccess({role:'staff', screen:'agents', action:'view', staffStatus:'Suspended', roleStatus:'Active', rolePerms:['agents:view']}), 'deny-403')
assert.equal(decideAdminAccess({role:'agent', screen:'agents', action:'view'}), 'deny-403')
```
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** `src/lib/permissions.ts` (pure; no Prisma/next-auth imports).
- [ ] **Step 4: Run** → PASS; `tsc` ≤ 23.
- [ ] **Step 5: Commit** `feat(admin): per-screen view/manage permission catalog + authz core`

---

### Task 2: Schema v2 + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: generated migration under `prisma/migrations/`

**Interfaces — Produces (consumed later):**
- `Department`: add `leadId String?` + `lead StaffUser? @relation("DeptLead", fields:[leadId], references:[id], onDelete: SetNull)`.
- `StaffUser`: add `departmentId String?` + `department Department? @relation(fields:[departmentId], references:[id])`; `password String?` (nullable); add `inviteTokenHash String?`, `inviteExpiresAt DateTime?`. `status` default `"Invited"`. Keep `roleRef`/`roleId` from v1. Add the reverse relation `ledDepartments Department[] @relation("DeptLead")`.
- **Drop** the vestigial legacy `StaffUser.role` and `StaffUser.permissions` columns (unused since v1; no prod data).
- `Role.permissions` semantics change to `screen:action` tokens (no column change; still `String @default("[]")`).

- [ ] **Step 1:** Edit `schema.prisma` per above (mind the two `StaffUser`↔`Department` relations: membership + `DeptLead` — name them explicitly).
- [ ] **Step 2:** `npx prisma validate` → OK.
- [ ] **Step 3:** `NEXTAUTH_SECRET=test npx prisma migrate dev --name user_management_v2` then `npx prisma generate`.
- [ ] **Step 4: Verify** the migration SQL: adds `Department.leadId` + FK (SetNull); adds `StaffUser.departmentId` + FK, `inviteTokenHash`, `inviteExpiresAt`; makes `password` nullable; `status` default `Invited`; **drops** `role`/`permissions` from `StaffUser`. If SQLite rebuilds `StaffUser`, confirm all still-wanted columns + rows are preserved and only `role`/`permissions` are dropped. Paste the SQL into the report. If `migrate dev` wants a reset → STOP, report BLOCKED.
- [ ] **Step 5: Commit** `feat(admin): v2 schema — dept lead, staff departmentId, invite fields, drop legacy role cols`

---

### Task 3: Guards v2 — `requirePermission(screen, action)`, `requireAdminArea`, `requireDeptManage`

**Files:**
- Modify: `src/lib/admin-guard.ts`
- Rewrite: `tests/admin-guard.test.ts`

**Interfaces — Consumes:** `decideAdminAccess`/`parsePermissions`/`canGrant`/`ScreenKey`/`Action` (T1); Prisma `StaffUser`(`status`,`departmentId`,`roleRef{status,permissions}`), `Department`(`leadId`) (T2).
**Produces:**
- `AdminGuard` (unchanged shape: `{ ok; session; actor:{id?;name;type:'superadmin'|'staff'} } | { ok:false; response }`).
- `requirePermission(screen: ScreenKey, action: Action): Promise<AdminGuard>` (replaces the v1 area version).
- `requireAdminArea(): Promise<AdminGuard>` (unchanged).
- `requireDeptManage(departmentId: string): Promise<AdminGuard>` — superadmin→allow; staff→fresh-load `{id,status,departmentId}` + the department's `leadId`; allow iff `status==='Active'` AND `staff.id===dept.leadId` AND `staff.departmentId===departmentId`; else 403/401.
- Keep `requireSuperAdmin()`/`adminActor()`.
- Internal `resolveAdminAccess(screen,action)` and `resolveDeptManage(departmentId)` injectable-deps for testing (per v1 pattern).

- [ ] **Step 1: Write failing tests** (injected fakes): `requirePermission` — superadmin allow (no DB read); active staff w/ `screen:manage` → manage allow + view allow; staff w/ only `:view` → manage 403; suspended/archived-role/role-less → 403; agent → 403; no session → 401. `requireDeptManage` — superadmin allow; active lead of that dept (departmentId matches) → allow; lead but Suspended → 403; listed as `leadId` but `departmentId` now differs → 403; non-lead staff → 403; no session → 401. Assert 401 body `{error:'Unauthorized'}`, 403 `{error:'Forbidden'}`.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `tsc` ≤ 23.
- [ ] **Step 5: Commit** `feat(admin): v2 guards — per-screen permission + bounded requireDeptManage`

---

### Task 4: Login gating v2 (Active + password only)

**Files:**
- Modify: `src/lib/admin-identity.ts` (`pickIdentity`)
- Modify: `src/app/api/admin-auth/login/route.ts`, `src/lib/auth-admin.ts`
- Modify: `tests/admin-login-identity.test.ts`

**Interfaces:** `pickIdentity` staff input gains `password: string | null`; a staffer qualifies only when `status==='Active'` AND `password != null`. `Invited`/`Suspended`/null-password → `{kind:'none'}`. SuperAdmin branch unchanged (wins on email). Both auth files pass the staff `password`/`status` into `pickIdentity` and never mint a token for a non-qualifying staffer.

- [ ] **Step 1: Write failing tests**: active staff w/ password → staff; `status:'Invited'` (null password) → none; `Suspended` → none; `Active` but `password:null` → none; superadmin present → superadmin.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** `pickIdentity` + wire both files (fetch `password`/`status`; keep lowercased-email lookup + staff `lastActiveAt` best-effort try/catch from v1).
- [ ] **Step 4: Run** → PASS; `tsc` ≤ 23.
- [ ] **Step 5: Commit** `feat(admin): only Active staff with a password can sign in`

---

### Task 5: Invite-token core + accept-invite API + page

**Files:**
- Create: `src/lib/invite-token.ts` (pure-ish token helpers)
- Create: `src/app/api/admin-auth/accept-invite/route.ts` (POST; unauthenticated)
- Create: `src/app/superadmin/accept-invite/page.tsx` (public set-password page)
- Create: `tests/invite-token.test.ts`

**Interfaces — Produces:**
- `generateInviteToken(): { raw: string; hash: string; expiresAt: Date }` — `raw` = `crypto.randomBytes(32).toString('hex')`; `hash` = `sha256(raw)`; `expiresAt` = now + 48 h.
- `hashInviteToken(raw: string): string` (sha256 hex) — pure, for lookup.
- `isInviteUsable(staff: { inviteTokenHash: string|null; inviteExpiresAt: Date|null; status: string }, now: Date): boolean` — true iff hash present, not expired, `status==='Invited'`.
- `POST /api/admin-auth/accept-invite` `{ token, newPassword }`: `hashInviteToken(token)` → `staffUser.findFirst({ where:{ inviteTokenHash } })`; reject (generic 400) if none; else check `isInviteUsable` (expired/consumed → 400); `newPassword` ≥ 8 (400); attempt-cap keyed on the resolved staff id (reuse the limiter pattern); on success set bcrypt `password`, `status:'Active'`, clear `inviteTokenHash`/`inviteExpiresAt`; audit `staff_invite_accepted`. Single-use. Never log token/password.
- The page reads `?token=`, posts to the route, handles success/expired/error states; links to `/superadmin/login` on success.

- [ ] **Step 1: Write failing tests** `tests/invite-token.test.ts` for the pure helpers: `generateInviteToken` → 64-hex raw, matching `hashInviteToken(raw)`, expiry ~48 h; `hashInviteToken` deterministic; `isInviteUsable` — usable when Invited+unexpired+hash; false when expired / `status!=='Invited'` / no hash.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** the helpers, the route, the page.
- [ ] **Step 4: Run** → PASS; `tsc` ≤ 23.
- [ ] **Step 5: Commit** `feat(admin): invite-token core + accept-invite flow`

---

### Task 6: Invite email + staff create/resend wiring

**Files:**
- Modify: `src/lib/mail.ts` (or an email-templates module) — add the invite email
- Modify: `src/app/api/admin/staff/route.ts` (POST) and a resend endpoint `src/app/api/admin/staff/[id]/resend-invite/route.ts`

**Interfaces — Consumes:** `generateInviteToken` (T5), `sendMail`, `requireDeptManage`/`requireSuperAdmin` (T3). (Full staff-API rework is Task 9; here, only the invite issuance + email.)
- Invite email: name + "you've been given access" + the link `${process.env.NEXTAUTH_URL}/superadmin/accept-invite?token=${raw}`. **No password.** `sendMail` is prod-only (no-op off-prod).
- Create (in T9) and resend both: set `inviteTokenHash`/`inviteExpiresAt`/`status:'Invited'`, send the email, and **return the raw link once** in the API response for the creator UI (never stored, never logged). Resend invalidates the prior token.

- [ ] **Step 1:** Add the invite email sender; add the resend route (`requireDeptManage` of the staffer's department, or owner); return the one-time link.
- [ ] **Step 2:** `tsc` ≤ 23; unit suite green. (No new pure unit beyond T5; the email/route are integration-reviewed.)
- [ ] **Step 3: Commit** `feat(admin): invite email + resend-invite`

---

### Task 7: Per-handler permission enforcement remap (BATCH)

**Files:** every admin route handler (the v1 route tree). Swap each handler's v1 area guard for `requirePermission(screen, action)` — `GET`→`(screen,'view')`, each mutating handler→`(screen,'manage')` — per a complete handler→screen map the implementer derives from the route tree and the delta's screen table. View-only screens (`agent-wallets`,`transactions`,`audit`,`reports`) must never gate a mutating handler. `stats`/`me` stay `requireAdminArea()`. Staff/role/department management routes are handled in Tasks 8–9 (owner/lead), not here.

- [ ] **Step 1:** Remap every handler; keep business logic byte-identical; keep the v1 `guard.actor` audit attribution.
- [ ] **Step 2: Verify:** no route handler left on the old area guard; `grep` shows every admin route guarded; spot-check GET=view / mutating=manage; view-only screens have no `:manage` anywhere. Paste greps in the report.
- [ ] **Step 3:** `tsc` ≤ 23; unit suite green.
- [ ] **Step 4: Commit** `feat(admin): enforce per-screen view/manage on every admin route handler`

---

### Task 8: Departments & Roles API v2 (owner + bounded lead) + combined create

**Files:** `src/app/api/admin/departments/route.ts` (+ inline-roles on create), `…/departments/[id]/route.ts` (+ `leadId` set, owner-only), `…/roles/route.ts`, `…/roles/[id]/route.ts`.

**Interfaces — Consumes:** `requireSuperAdmin`/`requireDeptManage` (T3), `validateRolePermissions`/`canGrant` (T1).
- Department create/rename/archive: **owner-only**. Create accepts optional inline `roles: {name, permissions}[]` (each validated).
- Set/clear `Department.leadId`: **owner-only**; validate the lead is an `Active` StaffUser whose `departmentId` is this department (400 otherwise).
- Role create/edit: **owner OR lead of the role's department** (`requireDeptManage(departmentId)`). For a non-owner, enforce the bound: `canGrant(leadPerms, resultingPerms)` AND `canGrant(leadPerms, currentPerms)` — else 403 (overreach/can't-touch). Permissions run through `validateRolePermissions`; unknown tokens → 400 naming them. Owner is unbounded.
- Role list (GET): owner → all (optionally by dept); lead → their department only.
- No DELETE (archive via status).

- [ ] **Step 1: Write failing test** (pure, add to `tests/role-permissions-validate.test.ts` or new): the bound predicate `canEditRole(leadPerms, currentPerms, resultingPerms)` (extract to permissions.ts): allow iff `canGrant(lead,current) && canGrant(lead,resulting)`; deny when current exceeds lead; deny when resulting exceeds lead. Owner path bypasses (tested at guard level).
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** the predicate + the four routes with owner/lead guards + the bound + inline-roles-on-create + owner-only leadId.
- [ ] **Step 4: Run** → PASS; `tsc` ≤ 23; suite green.
- [ ] **Step 5: Commit** `feat(admin): v2 departments/roles API — inline roles, owner-set lead, bounded lead role edits`

---

### Task 9: Staff API v2 (departmentId, lead-scoped, invite create)

**Files:** `src/app/api/admin/staff/route.ts` (GET+POST), `…/staff/[id]/route.ts` (PATCH+DELETE). Update `src/lib/staff-response.ts`.

**Interfaces — Consumes:** `requireSuperAdmin`/`requireDeptManage` (T3), invite issuance (T6).
- POST create: `{ name, email, roleId }` — **no password** (invite flow, T6). Owner may create in any dept; a **lead** may only create with `departmentId` = their dept and a `roleId` whose role is in that dept. Set `departmentId`, `status:'Invited'`, issue invite, return the one-time link. Email lowercased; identity-conflict check kept.
- PATCH: `{ roleId?, status? }` — reassign role (must be in the staffer's `departmentId`; a lead cannot move across depts; `departmentId` change is owner-only), suspend/reactivate. Scoped: a lead may only PATCH staffers in their dept (`requireDeptManage(staffer.departmentId)`).
- GET list: owner → all; lead → `where:{ departmentId: leadDept }`. Response (via `toStaffResponse`): `{ id, name, email, status (Invited/Active/Suspended), lastActiveAt, createdAt, department:{id,name}|null, role:{id,name}|null, hasApprovalPin, isLead }` — never `approvalPin`/`password`/`inviteTokenHash`.
- DELETE: owner, or lead for their own dept's staffer.

- [ ] **Step 1:** Implement GET/POST/PATCH/DELETE with owner-vs-lead scoping and the invite-create path; update the response mapper (new fields; still no hash leak).
- [ ] **Step 2: Verify** (grep) the response omits `password`/`approvalPin`/`inviteTokenHash`; `tsc` ≤ 23; suite green. (If a pure scoping/selector helper is extracted, add a shape test.)
- [ ] **Step 3: Commit** `feat(admin): v2 staff API — invite create, departmentId, lead-scoped management`

---

### Task 10: `/api/admin/me` v2

**Files:** `src/app/api/admin/me/route.ts`.
**Interfaces:** `requireAdminArea()`; superadmin → `{ role:'superadmin', perms: <all screen:manage+view>, isLead:false, hasApprovalPin }`; staff → `{ role:'staff', perms: <fresh parsed role perms>, isLead, leadDepartmentId?, hasApprovalPin }`. Fresh read; no hashes.

- [ ] **Step 1:** Update the endpoint (perms list + `isLead`/`leadDepartmentId`).
- [ ] **Step 2:** `tsc` ≤ 23; suite green.
- [ ] **Step 3: Commit** `feat(admin): /api/admin/me returns per-screen perms + lead status`

---

### Task 11: UI — combined department+roles creation & department hub

**Files:** `src/app/superadmin/staff/page.tsx` + `_components/*` (rework the Departments/Roles views into a department-hub model).
**Interfaces — Consumes:** departments/roles APIs (T8), `SCREENS`/`AREA`-equivalents/`MONEY_SCREENS` (T1).
- Create-department dialog adds inline role rows (name + the permission matrix from Task 12). Opening a department shows its roles, its lead (owner can set/clear via a staffer picker), and its people. The standalone Roles tab becomes the per-department roles view.
- Owner sees all departments; a lead sees only their own department as the hub.

- [ ] **Step 1:** Build the hub + combined create; loading/empty/error; 360px.
- [ ] **Step 2:** `tsc` ≤ 23; suite green; note if `next build --webpack` was run.
- [ ] **Step 3: Commit** `feat(admin): combined department+roles creation and department hub`

---

### Task 12: UI — per-screen view/manage role-editor matrix

**Files:** `src/app/superadmin/staff/_components/*` (the role editor).
**Interfaces — Consumes:** `SCREENS`, `MONEY_SCREENS`, `type Perm` (T1); `/api/admin/me` (T10) for the lead ceiling.
- Matrix grouped by nav group; each screen a row with a **View** and (where the screen has it) a **Manage** checkbox; ticking Manage auto-ticks View; money screens flag the Manage cell. Submits a normalized `Perm[]`.
- For a **lead**, cells outside the lead's own ceiling are disabled (can't grant beyond self); surface the server 400 if it still happens.

- [ ] **Step 1:** Build the matrix (owner: full; lead: ceiling-bounded).
- [ ] **Step 2:** `tsc` ≤ 23; suite green.
- [ ] **Step 3: Commit** `feat(admin): per-screen view/manage role-editor matrix`

---

### Task 13: UI — People v2 (invite, status, lead-scoped)

**Files:** `src/app/superadmin/staff/_components/*` (People view).
**Interfaces — Consumes:** staff API (T9), invite one-time link (T6).
- Create sends an invite; the success UI shows the one-time link to copy (email also sent in prod). Rows show department·role, **Invited/Active/Suspended**, PIN indicator, last active. Actions: resend invite (Invited), reassign role (within dept), suspend/reactivate, remove (confirm). A lead sees only their department's people and cannot move anyone across departments.

- [ ] **Step 1:** Build People v2 (invite + status + resend + scoping).
- [ ] **Step 2:** `tsc` ≤ 23; suite green.
- [ ] **Step 3: Commit** `feat(admin): People v2 — invites, statuses, lead-scoped management`

---

### Task 14: UI — nav/no-access/home v2 + Staff & access for leads + self-service

**Files:** `src/app/superadmin/_components/AdminShell.tsx`, `src/app/superadmin/page.tsx`, the no-access panel, `useMyAccess`.
**Interfaces — Consumes:** `/api/admin/me` v2 (T10), `SCREENS`/`MONEY_SCREENS` (T1), self-service `me/*` (v1).
- Nav items keyed on the screen's `:view`. **Staff & access** shows for superadmin **and** any staffer where `isLead` (opening a scoped hub). Fail-closed while `/me` loads (Home only). No-access panel keyed on the current screen's `:view`. Home tiles each gated on their screen's `:view`. Self-service password/PIN unchanged (PIN control shows when the actor holds any `MONEY_SCREENS:manage`).

- [ ] **Step 1:** Update nav filter, no-access, resilient home, Staff-&-access-for-leads, PIN-control gating.
- [ ] **Step 2:** `tsc` ≤ 23; suite green.
- [ ] **Step 3: Commit** `feat(admin): v2 nav/no-access/home + lead Staff&access + money-aware self-service`

## Self-Review
- **Spec coverage:** combined create (T11) ✓; per-screen view/manage (T1,T3,T7,T12) ✓; dept lead bounded (T2,T3,T8,T9,T11) ✓; invite email (T2,T5,T6,T9,T13) ✓; login gating (T4) ✓; migration (T2) ✓; nav/me/no-access (T10,T14) ✓.
- **Review Focus:** each of the five risks has an owning task with tests (lead escalation T1/T3/T8/T9; per-handler T7/T3; invite token T5; login gating T4; stale lead T3).
- **Interface consistency:** `Perm`/`ScreenKey`/`hasPermission`/`canGrant`/`canEditRole` defined in T1 and consumed by T3/T7/T8/T12; `requireDeptManage` (T3) consumed by T8/T9/T6; `StaffUser.departmentId`/`Department.leadId` (T2) consumed by T3/T8/T9; `/api/admin/me` v2 (T10) consumed by T12/T14; invite link (T6) consumed by T13.
- **Proportion:** 14 tasks for a catalog rework + per-handler enforcement + two new subsystems + UI; pure cores front-loaded (T1) so the risky logic is unit-tested before routes/UI depend on it.
