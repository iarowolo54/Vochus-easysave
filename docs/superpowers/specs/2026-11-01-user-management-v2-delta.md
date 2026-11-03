# User Management v2 — Design Delta

**Date:** 2026-11-01
**Status:** Awaiting owner approval. Extends `2026-11-01-user-management-design.md` (v1, built on branch `feature/user-management`, not yet merged). Nothing new is built until this is approved.

## Why

The v1 feature (departments → roles → staff logins, scoped server-side) was built and demoed on the branch. Watching the demo, the owner asked for four changes before merge:

1. **Combine department + role creation** — defining roles in a separate tab after making a department is clunky; do it in one flow.
2. **Granular access** — six all-or-nothing areas are too blunt (e.g. "Customers" bundles *viewing* customers with *approving redemptions*). Need exact control.
3. **Department leads** — appoint a lead per department who can manage that department's people and roles.
4. **Invite email on user creation** — new staff receive a secure set-password link instead of the owner handing out a password.

All four fold into the existing branch (the merge is held). The v1 plumbing — admin login for staff, fresh-per-request authorization, immediate revocation, audit attribution to the acting actor, the PIN flow, the fail-closed nav — is unchanged and carries straight into v2.

## Change 1 — Combined department + roles creation (UX)

When creating a department, the same dialog lets the owner add one or more roles inline (each: name + its permissions). Roles can still be added/edited later from the department's view. The separate top-level "Roles" tab becomes a per-department roles view (reached by opening a department), not a disconnected tab.

- **Model:** unchanged (Role already belongs to a Department).
- **UI:** the Departments view is the hub; opening a department shows its roles and (for the owner) its lead; "add role" lives there and in the create-department flow.

## Change 2 — Per-screen, view/manage permission model (the core change)

Replace the six coarse areas with **per-screen permissions**, each carrying a **view** and (where meaningful) a **manage** action. **manage implies view.**

### Permission tokens
A role's `permissions` becomes a JSON array of `"<screen>:<action>"` strings, `action ∈ {view, manage}`, e.g. `["customers:view","redemptions:view","redemptions:manage"]`. The catalog is fixed in code.

### Screen catalog (grouped as the nav is; `V`=view only, `V/M`=view+manage)
| Group | Screen key | V / V-M | manage covers |
|---|---|---|---|
| Agents | `agents` | V/M | activate, block/unblock, profile-lock, reset-device, resend-verification, invite, doc-approve |
| Agents | `agent-wallets` | V | — |
| Agents | `withdrawals` | V/M | approve/decline/finalize-otp agent withdrawals |
| Agents | `commission` | V/M | set commission rates |
| Agents | `rewards` | V/M | create/edit/delete rewards |
| Customers | `customers` | V/M | status/suspend customers |
| Customers | `savings` | V/M | savings-interest & interest-rate config |
| Customers | `redemptions` | V/M | approve/decline/finalize-otp redemptions |
| Loans | `loans` | V/M | approve/reject loan requests |
| Loans | `loan-disbursements` | V/M | disburse |
| Loans | `loan-repayments` | V/M | record repayments |
| Money | `treasury` | V/M | fund/inject-capital/capital-to-float/commission-payout; wallet accounts |
| Money | `transactions` | V | — |
| Money | `payout-mode` | V/M | toggle Auto/Manual |
| Cards | `cards` | V/M | generate, gift-card design |
| Oversight | `devices` | V/M | reset device |
| Oversight | `audit` | V | — |
| Oversight | `reports` | V | — |

(Builder may refine the exact screen↔route split against the real route tree; the view-only set — `agent-wallets`, `transactions`, `audit`, `reports` — must never gate a mutating handler.) The user-management screen itself is **not** in the catalog (owner + dept-lead only — see Change 3).

### Pure helpers (extend `src/lib/permissions.ts`)
- `SCREENS` (the catalog above, with per-screen `{label, group, actions: ('view'|'manage')[], manageNote?, handlesMoney?}`).
- `type Perm = \`${ScreenKey}:${'view'|'manage'}\``.
- `parsePermissions(raw)` → `Perm[]` (keep only valid tokens; dedupe; malformed → []).
- `hasPermission(perms: Perm[], screen, action)`: for `view`, true if perms has `screen:view` **or** `screen:manage`; for `manage`, true if perms has `screen:manage`. (manage implies view.)
- `validateRolePermissions(input)`: reject unknown/non-string tokens, naming them; return deduped `Perm[]`.
- `MONEY_SCREENS` (the handles-money set) for the PIN/flagging.
- `canGrant(granterPerms: Perm[], requested: Perm[])`: true iff every requested token is in `granterPerms` — the dept-lead escalation bound (Change 3).

### Guard (extend `src/lib/admin-guard.ts`)
- `requirePermission(screen, action)` replaces `requirePermission(area)`: superadmin → allow; staff → fresh-load role perms, `decideAdminAccess` with `hasPermission`.
- `requireAdminArea()` baseline unchanged.
- Enforcement is **per handler**: a route file's `GET` → `(screen,'view')`; each mutating handler (`POST`/`PATCH`/`DELETE`) → `(screen,'manage')`. (More precise than v1's one-area-per-file.)

### UI
- **Role editor:** grouped by nav group; each screen shows a row with a **View** and a **Manage** checkbox (view-only screens show just View); money screens keep the amber "handles money" marker on their Manage. Ticking Manage auto-ticks View (manage implies view).
- **Nav filtering:** a nav item shows if the actor has that screen's `:view`. Home always; Staff & access per Change 3.
- **No-access panel:** keyed on the screen's `:view`.
- **`/api/admin/me`:** returns `{ role, perms: Perm[], isLead, leadDepartmentId?, hasApprovalPin }`.
- **Home dashboard:** each tile/section gated on its screen's `:view`.

## Change 3 — Department leads (delegated, bounded)

An owner can appoint one **lead** per department: a staffer in that department who can **manage that department's people and roles**. Creating/renaming/archiving departments and appointing/removing leads stays **owner-only**.

### Model
- `Department.leadId String?` → FK to `StaffUser` (nullable; must be a staffer whose role is in that department — validated on set).

### What a lead can do (within their own department only)
- Create & **edit roles** in the department — but **only grant permissions the lead themselves holds** (`canGrant`); an attempt to grant beyond their ceiling is a 400. (This is the load-bearing anti-escalation rule.)
- Create staff logins in the department (sends the invite — Change 4), assign/reassign them to the department's roles, suspend/reactivate them.
- **Cannot:** manage other departments, create/archive departments, appoint/remove any lead (including themselves), or grant permissions beyond their own.

### Guard
- New `requireDeptManage(departmentId)`: superadmin → allow; staff who **is the lead of that exact department** → allow; else 403. (Lead status read fresh from the DB.)
- The staff/role management routes move from `requireSuperAdmin()` to a check that is owner-or-lead-of-the-target-department, with department-managing and lead-setting operations staying `requireSuperAdmin()`.
- Role create/edit by a non-owner runs `canGrant(leadPerms, requested)` and 400s on overreach. (Owner is unbounded.)

### UI
- **Staff & access** nav item shows for superadmin **and** for any staffer who is a dept lead — but a lead sees a **scoped** view: only their department, its roles, and its people. The owner sees everything plus the lead selector per department.
- `/api/admin/me` exposes `isLead` + `leadDepartmentId` so the shell can show the scoped Staff & access entry.

## Change 4 — Invite-link set-password email (no owner-set password)

Creating a staffer (by owner or lead) sends them a secure, expiring **set-password link**; the staffer sets their own password. The owner/lead never sets or sees it.

### Model (`StaffUser`)
- `password` → **nullable** (set by the staffer on accept).
- Add `inviteTokenHash String?`, `inviteExpiresAt DateTime?`.
- `status` gains `"Invited"` (default on create) → becomes `"Active"` on accept; `"Suspended"` unchanged.

### Flow
- **Create:** generate a token with `node:crypto` (32 random bytes, hex); store only its hash (`sha256`) + `inviteExpiresAt` (48h); `status:'Invited'`, `password:null`. Build the link `/<app>/superadmin/accept-invite?token=<raw>`. Send the invite email via `sendMail` (prod-only; no-op off-prod). **Return the link once to the creator's UI** (shown on the success screen) so it works in dev and as a fallback if email fails. Never log the raw token.
- **Accept:** public page `/superadmin/accept-invite` + `POST /api/admin-auth/accept-invite` `{ token, newPassword }` (unauthenticated, but requires a valid token): look up by token hash, reject if missing/expired/already-active, enforce newPassword ≥ 8, set the bcrypt password, clear the token, `status:'Active'`. Rate-limit attempts (reuse the attempt-limiter pattern); single-use; never log the token or password.
- **Resend invite:** owner/lead action regenerates the token + expiry and re-sends (invalidates the old link).
- **Login gating:** only `status:'Active'` staff with a non-null password can log in (`pickIdentity` treats `Invited`/`Suspended`/null-password as "none"). Email normalized lowercase (carried from v1).
- The email body contains the person's name, that they've been granted access, and the link — **never a password**.

## Migration (forward-only)
- `Department.leadId` (nullable FK → StaffUser, `onDelete: SetNull`).
- `StaffUser`: add `departmentId` (nullable FK → Department — explicit membership, see resolution 1); `password` nullable; add `inviteTokenHash`, `inviteExpiresAt`; `status` default `"Invited"` for new rows (existing rows keep `Active`).
- `Role.permissions` now holds `screen:action` tokens — the format changes, but there is **no production data** (v1 is unmerged/undeployed), so no data conversion is needed; any dev-only v1 roles become empty/invalid-filtered and are re-created. Retire the already-vestigial legacy `StaffUser.role`/`permissions` columns in this migration (still unused).

## Non-goals (v2)
- No SSO / external identity. Invite email is the only outbound comms (plus resend).
- No per-record ACLs; permissions are per-screen, not per-row.
- One lead per department (not multiple). A lead cannot appoint leads or manage other departments.
- No per-field permissions within a screen beyond view/manage.

## Review Focus (new risks this introduces)
1. **Lead privilege escalation:** a lead must never grant a permission beyond their own (`canGrant`), manage another department, appoint/remove a lead, or create/archive departments. Each enforced server-side and tested.
2. **Per-handler enforcement:** every mutating handler requires `:manage` (never just `:view` or nothing); the four view-only screens never gate a mutation; no handler left unguarded. A grep + test proves it.
3. **Invite-token security:** `node:crypto` generation, hashed at rest, single-use, 48h expiry, rate-limited, never logged; accept-invite rejects wrong/expired/consumed tokens and never re-opens an already-Active account.
4. **Login gating:** `Invited`/`Suspended`/null-password staff cannot authenticate (both the custom route and `authorize`).
5. **manage-implies-view:** a staffer with only `screen:manage` is not blocked from that screen's list/detail view.

## Builder-check resolutions (decided; flagged for the owner to sanity-check)

1. **Department membership is explicit.** Add `StaffUser.departmentId String?` (nullable FK → Department). Membership is this field, NOT derived from the role. Rules: a staffer's assigned role must belong to their `departmentId` (validated on assign). A lead manages exactly the staffers whose `departmentId` equals the lead's department — the ownership `where` is `{ id, departmentId: leadDept }`. When a lead creates a staffer, `departmentId` is forced to the lead's department and the assigned role must be one of that department's roles. A lead **cannot** move a staffer to another department or pull a foreign staffer in (changing `departmentId` is owner-only). The owner can set any `departmentId`.

2. **`canGrant` ceiling + edit semantics.** `validateRolePermissions` **normalizes** stored perms so every `screen:manage` also carries `screen:view`. `canGrant(granterPerms, requested)` is literal subset against the granter's *normalized* perms (so a lead holding `x:manage` can grant `x:view`). On role **edit by a non-owner**, the check is on the **whole resulting set** AND the **current set**: a lead may edit a role only if *both* `canGrant(leadPerms, currentRolePerms)` and `canGrant(leadPerms, resultingPerms)` hold — so a lead cannot touch (nor be forced to nerf) a role that already exceeds their ceiling, and cannot launder perms by dropping-then-re-adding. The owner is unbounded.

3. **`requireDeptManage` re-validates the lead, never trusts `leadId` alone.** Allow iff superadmin, OR the signed-in staffer is `Active`, is `dept.leadId`, **and** their `departmentId` still equals that department (all read fresh). A suspended, moved, or role-stripped lead loses lead powers even while `leadId` still points at them. `Department.leadId` FK is `onDelete: SetNull`.

4. **accept-invite throttle.** Tokens are 32 random bytes (`node:crypto`) stored as a SHA-256 hash, single-use, 48 h expiry — blind spraying is infeasible, so no IP/global throttle. A light attempt cap (reusing the existing attempt-limiter pattern) is keyed on the **resolved staff id** (from the token-hash lookup) to bound repeated wrong submissions against a leaked-but-valid link; a token that resolves to no staffer fails generically with no DB write (no new attempts table needed).

5. **Invite is the sole staff-creation path.** `POST /api/admin/staff` drops the `password` field entirely and always issues an invite (`status:'Invited'`, `password:null`). The accept-invite link host is `process.env.NEXTAUTH_URL` (matching the existing resend-verification pattern).

## What's left to the builder
- The exact route-handler → `(screen, action)` map across the current route tree (one per handler), and the view-only guarantee.
- The precise Prisma field types/indexes and the forward-only migration SQL.
- The accept-invite page styling and the invite email template copy.
- The role-editor matrix layout (grouped, view/manage columns, money markers) and the scoped (lead) vs full (owner) Staff & access views.
- Tests per the Review Focus list (all pure cores — `hasPermission`, `validateRolePermissions`, `canGrant`, invite-token verify, login gating — plus the lead-scoped guard).
