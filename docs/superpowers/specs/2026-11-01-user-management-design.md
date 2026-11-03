# Super-Admin User Management — Design

**Date:** 2026-11-01
**Status:** Awaiting owner approval (nothing is built until this doc is approved)

## Intent & Why

Today the EasySave admin area has exactly one kind of login: the owner's
`SuperAdmin` account, which can do everything. There is no way to give a
staff member a *limited* login — e.g. someone who handles customer support
but can't move money, or a finance person who sees reports but can't touch
agents.

A **stub** for this already exists and is deliberately inert:

- A `StaffUser` table (name, email, hashed password, a free-text `role`, a
  JSON `permissions` array, `status`, `lastActiveAt`).
- A **Staff & access** page at `/superadmin/staff` that creates/edits/suspends
  staff rows.
- A banner on that page that says, in the code: *"Staff accounts can't sign
  in yet… the roles and access set here aren't applied anywhere for now."*

Confirmed gaps: staff **cannot log in** (the admin login authenticates only
the `SuperAdmin` table), and the stored permissions are **enforced nowhere**
(every admin route and page checks only `role === 'superadmin'`). There are
**no** Department or Role tables.

This project turns the stub into a working role-based access system: the
owner creates **departments**, defines **roles** within them (each role
granting a set of areas), creates staff **logins**, and assigns each staffer
to a role. Staff can then sign in and see/do only what their role allows.

## Goals

1. The owner can create/rename/retire **departments** (e.g. Operations,
   Finance, Support).
2. The owner can create **roles** inside a department, each granting a chosen
   set of **area permissions** from a fixed catalog.
3. The owner can create **staff logins** (email + initial password) and assign
   each to exactly one role (which places them in that role's department).
4. Staff can **sign in** to the admin area through the existing admin login.
5. A staffer sees and can use **only their permitted areas** — enforced on the
   **server** for every admin page and API route, not just hidden in the nav.
6. Revoking/adjusting a staffer's access takes effect **immediately** (next
   request), not whenever their session happens to expire.
7. The owner (`SuperAdmin`) remains the apex: full access, bypasses every
   permission check, and is the **only** account that can manage departments,
   roles, and staff.

## Non-Goals / Anti-Goals

- **No view-vs-act split.** Permissions are **area-level**: having an area
  grants full control of everything in it, *including money actions in that
  area* (approving agent withdrawals, redemptions, loan disbursement). The
  owner has accepted this tradeoff for simplicity. (A finer "can view but not
  approve" split is a possible future follow-up, explicitly out of scope now.)
- **No staff-managed staff.** Only the owner manages departments/roles/users.
  No delegated "manage staff" permission in this version — this removes the
  privilege-escalation surface entirely.
- **No custom permission types.** The permission catalog is fixed in code.
  The owner *composes* roles from the catalog; they do not invent new
  capability primitives.
- **No email invites / SSO.** The owner sets each staffer's initial password
  directly (as the stub already does). Staff can change their **own** password
  after signing in. Invite emails / SSO are out of scope.
- **Not touching** the agent or customer auth systems — admin area only.

## Constraints (from the codebase)

- **Three independent auth systems** share `NEXTAUTH_SECRET`; an agent token
  placed in the admin cookie *decodes fine*. So authorization must key on the
  exact `role` claim **and** re-verify staff against the DB — never trust a
  bare "cookie decodes" check. (`.claude/rules/auth-security.md`.)
- **Authorization is server-side.** The client only hides UI. Every admin
  route derives the actor and checks permission server-side.
- Prisma + SQLite, datasource hardcoded to `file:./dev.db`; 2 PM2 cluster
  instances on one file — keep transactions short.
- Session expiry is enforced by the Next 16 Proxy (`src/proxy.ts`); durations
  live in `src/lib/session-policy.ts`. Admin: 15 min idle / 8 h absolute.
- No hardcoded secret fallbacks; audit sensitive actions with `logAudit`.
- `AuditLog` is append-only.
- Plain CSS, match existing admin styles; screens must work at ~360px
  (Flutter WebViews).

## How It Works (the decided design)

### Data model

```
Department 1 ── * Role 1 ── * StaffUser
```

- **Department**: `id`, `name` (unique), `description?`, `status`
  (Active/Archived), `createdAt`. Cannot be hard-deleted while it has roles
  or staff — archived instead.
- **Role**: `id`, `departmentId` (FK), `name` (unique within department),
  `permissions` (JSON string array of area keys from the catalog),
  `status`, `createdAt`. Cannot be hard-deleted while staff are assigned —
  archived instead.
- **StaffUser** (repurpose the existing table): keep `id`, `name`, `email`,
  `password`, `status`, `lastActiveAt`, `createdAt`. **Add** `roleId` (FK,
  nullable — an unassigned staffer has *no* access) and `approvalPin`
  (nullable, bcrypt hash — set by the staffer, mirrors `SuperAdmin.approvalPin`).
  The legacy free-text `role` and JSON `permissions` columns are retired
  (see Migration).

### Permission catalog (fixed, in code)

Area keys follow the existing admin nav groups so the owner's mental model,
the UI filtering, and enforcement all line up. Each key unlocks the pages and
API routes under that group:

| Area key    | Unlocks (pages / API) | Note |
|-------------|-----------------------|------|
| `agents`    | All agents, agent wallets, **withdrawals**, commission, rewards | includes approving agent payouts & setting commission |
| `customers` | All customers, savings monitor, **redemptions** | includes approving customer redemptions |
| `loans`     | Loan requests, **disbursements**, repayments, calculator | includes disbursing loans |
| `money`     | Treasury, wallet accounts, transactions, **payout mode** | includes flipping payout Auto/Manual |
| `cards`     | Card management, generate, gift-card design | |
| `oversight` | Devices, audit log, reports | read-oriented |

(`staff` / this user-management area is **not** in the catalog — it is
owner-only and ungrantable.)

The money-bearing areas are called out with **bold** so the owner sees, at
role-creation time, exactly which cash actions each area unlocks.

### Login & session

- Staff log in at the **same** `/superadmin/login` with email + password.
- **The real login path is the custom route `src/app/api/admin-auth/login/route.ts`**
  (the login page POSTs here and the route hand-mints the cookie + stamps
  `loginAt`) — *not* `signIn()`. So staff auth is added **there**: when the
  email isn't a `SuperAdmin`, look up an Active `StaffUser`, verify the
  password, and mint a cookie with `role: 'staff'`, `id` = the staff id, and
  `staffId`. The NextAuth config (`auth-admin.ts`) credentials provider +
  session callback are updated the same way so the `getServerSession` path
  stays consistent, but the UI goes through the custom route.
- The session carries `role: 'staff'` and `id`/`staffId` — **not** the
  permission list (permissions are read fresh per request so revocation is
  immediate). Populating `id` keeps audit attribution (`adminActor`) working
  for staff.
- The owner's session keeps `role: 'superadmin'` exactly as today.
- Session-expiry machinery (idle/absolute) applies unchanged to staff.

### Enforcement (the security-critical part)

- **Proxy (`src/proxy.ts`)**: the coarse admin gate changes from "role is
  superadmin" to "valid admin session whose role is `superadmin` **or**
  `staff`" for entry to the admin area; it still bounces agent/customer tokens
  and still enforces session expiry. The proxy does **not** do per-area
  mapping.
- **New server guard `requirePermission(area)`** (in `admin-guard.ts`):
  - `superadmin` → always allowed.
  - `staff` → load the StaffUser + role **fresh from the DB**; allow iff
    status is Active, role is Active, and the role's permissions include
    `area`. Otherwise 403.
  - Returns the resolved actor for `logAudit`.
- **New baseline guard `requireAdminArea()`** — any valid `superadmin` **or**
  Active `staff` session, with no specific area required. Used by the
  shell-wide endpoints every signed-in staffer hits regardless of role (e.g.
  `/api/admin/stats`, which `AdminShell` calls on every page load for the
  badge). "Authenticated admin-area user" is a baseline, **not** a grantable
  area in the catalog.
- **`requireSuperAdmin()` stays** and is used by the owner-only routes
  (departments, roles, staff management) and the money-approval PIN setup.
- Every admin API route is mapped to its area and switched from
  `requireSuperAdmin()` to `requirePermission('<area>')` — *except* the
  shell-wide baseline routes (`requireAdminArea()`) and the user-management
  routes (`requireSuperAdmin()`).
- **The authoritative gate is the API layer** (server-side, every data fetch).
  Admin pages are all `'use client'` today and there is no server layout to
  hang a check on, so we do **not** restructure the 25-page tree: a staffer
  who deep-links a forbidden page gets a client **nav-filter + redirect** to a
  clean "no access" view, and the page's own data fetches return 403 — so no
  data leaks even if the shell renders. (The security boundary is the API,
  not the page; the client redirect is UX.)

### Money-approval PIN for staff

- `StaffUser.approvalPin` (nullable bcrypt hash), set by the staffer via a
  **set-my-PIN** control after sign-in (mirrors the owner's PIN).
- `src/lib/approval-pin.ts` `verifyApprovalPin` becomes **role-aware**: for a
  `superadmin` session it resolves the PIN from `SuperAdmin` (unchanged); for
  a `staff` session it resolves from `StaffUser`. A staffer with no PIN set
  gets the existing "No approval PIN set" 403 until they set one.
- A staffer granted a money-bearing area (`agents`, `customers`, `loans`,
  `money`) must set a PIN before they can approve cash; the **People** admin
  view surfaces whether each staffer has a PIN set (never the PIN itself).

### UI

- **Staff & access** area (owner-only), reworked into three views:
  1. **Departments** — list / create / rename / archive.
  2. **Roles** — within a department, create a role and tick the areas it
     grants (the catalog table above, money areas clearly flagged).
  3. **People** — create a staff login (name, email, initial password),
     assign a role, suspend/reactivate, reset password, remove.
- The admin **nav** filters to the signed-in staffer's permitted areas
  (cosmetic; server enforcement is the real gate).
- A staffer who lands on a forbidden page sees a plain "You don't have access
  to this area" message, not a crash.
- Staff get a **change-my-password** control (so the owner-set temp password
  can be rotated) and, if their role includes a money-bearing area, a
  **set-my-approval-PIN** control.
- All of this matches existing admin.css styles and works at 360px.

### Migration

- New `Department` and `Role` tables; add nullable `roleId` and `approvalPin`
  to `StaffUser`.
- Retire `StaffUser.role` (free-text) and `StaffUser.permissions` (JSON).
  Because the staff feature was never live (staff can't log in, permissions
  do nothing), there is no real staff data to preserve; any stray rows become
  unassigned (no access) until the owner assigns a role. A forward-only
  migration adds the tables/column; a follow-up migration drops the retired
  columns once the new path is confirmed.
- Audit every create/update/archive/assign/suspend via `logAudit`.

## What's Left to the Builder

- Exact Prisma field types/indexes and the migration SQL (forward-only).
- The precise page↔area and API-route↔area mapping table (every route under
  each nav group), derived from the current route tree.
- The "no access" page/redirect styling and the nav-filter wiring.
- Whether role `permissions` validation rejects unknown area keys (it should).
- Tests: the pure permission-check function (allow/deny matrix across the six
  areas + superadmin bypass + suspended staff + archived role), the guard's
  fail-closed behavior, the login path for a staff vs. owner vs. agent token
  in the admin cookie, and `verifyApprovalPin` resolving the PIN correctly for
  a staff session vs. an owner session (and refusing a staffer with no PIN).

## Review resolutions (builder-check, 2026-11-01)

- **Owner decision:** staff who are granted a money-bearing area **set their
  own approval PIN** and use it to approve cash — the second factor stays on
  every real transfer. (This reversed the earlier "no staff PIN" idea, which
  the review showed could not hold: the PIN check resolves only against the
  owner account today, so without a staff PIN a staffer could not perform the
  money actions their area grants.)
- **Builder calls** (my judgment, flagged here for the owner to sanity-check):
  (1) staff auth is added to the **custom login route** the UI actually uses,
  not just the NextAuth provider; (2) the authoritative permission gate is the
  **API layer**, with a client nav-filter + no-access redirect for pages
  (no 25-page server-layout restructure); (3) a **`requireAdminArea()`**
  baseline guard covers shell-wide endpoints like `/api/admin/stats` so every
  signed-in staffer's shell renders; (4) the staff session populates `id` so
  audit attribution keeps working.
```
