# Customer Photo Deadline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers with no photo get three days of coloured warnings, then nobody can start a saving for them until a photo is on the account. Online customers take their own photo, which goes straight on. Photos taken by agents go to the super admin to approve or reject.

**Architecture:** One pure module (`src/lib/photo-deadline.ts`) owns the deadline, the day colour and the block decision. Every route that starts a saving calls its `photoSaveBlock`. A second module (`src/lib/customer-photo-request.ts`) owns agent photo submissions and their review, on a new `CustomerPhotoRequest` table, with notifications from the catalogue. The screens read a small `photo` status object from existing endpoints, never the base64 photo.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before writing routes), Prisma + SQLite, node:test via `npx tsx --test`, plain CSS in `src/app/globals.css` and `src/app/superadmin/admin.css`.

**Spec:** `docs/superpowers/specs/2026-11-12-customer-photo-deadline-design.md`

## Global Constraints

- Build in a worktree: `./scripts/new-worktree.sh photo-deadline`. Its `dev.db` is throwaway, so integration tests (`*.int.test.ts`) may run there. Never run them in the main folder.
- Deadline: 00:00 WAT (UTC+1, no daylight saving) at the start of the 4th calendar day, where go-live day is day 1. It's stored once as `PlatformSetting` key `photoDeadline`, value an ISO string. No row means no warnings and no block.
- Colours: day 1 green, day 2 yellow, day 3 red. After the deadline, red with "Saving is paused".
- A photo waiting for review does not count. A customer has a photo only when `Customer.photoUrl` is non-empty.
- Blocked responses: HTTP 403 `{ error: <message>, code: 'PHOTO_REQUIRED' }`.
- Customer photos are camera-only on screen; there is no file upload for customers. Agents use the existing camera-only `RetakePhotoSheet`.
- No SMS and no email for any of this.
- Pop-ups can always be closed, and come back on the next app open or sign-in.
- Never select `photoUrl` (base64) into a list or session. Send a status object or the existing photo link.
- Every submit, approve, reject and customer self-add is audited with `logAudit`. Actor wording on live data is "Developer", never "Claude".
- Notifications only through `src/lib/notifications.ts` plus the sweep, inside the same transaction as the change.
- No new `any`. `npx tsc --noEmit` must add no errors (baseline today: 23, all in loan routes).
- Every changed screen is checked at 360px wide, pop-ups included, before it's called done.
- Plain words in agent UI ([[plain-words-for-agents]]): "No photo", "Photo being checked", "Photo rejected".

## Review Focus

1. A photo is added or approved mid-session. Saving must work on the very next attempt, with no cached blocked state on the server or a stale screen that refuses. (Task 3 test: block, add photo, the same call passes.)
2. A bank transfer started before the deadline is matched by the bank-alert cron after it. It must still credit. (Task 3 test: `photoSaveBlock` is not called from the bank-alert credit path, enforced by the route-list test.)
3. The agent submits a photo twice before review. There must be one waiting request with the newer photo, never two. (Task 4 test.)
4. Approve or reject is pressed twice, or by two staff at once. The second must get 409 and change nothing. (Task 4 test.)
5. An offline customer, or an online customer who already has a photo, calls the customer photo route directly. Expect 403 and nothing stored. (Task 6 test.)

---

### Task 1: Photo request table

**Files:**
- Modify: `prisma/schema.prisma` (new model, and back-relations on `Customer` and `Agent`)
- Create: migration via `npx prisma migrate dev --name customer_photo_requests`

**Interfaces:**
- Produces: `prisma.customerPhotoRequest` with fields `id, customerId, agentId, status ('Pending'|'Approved'|'Rejected'), photoUrl String?, rejectReason String?, pendingCustomerId String? @unique, submittedAt, decidedAt?, decidedBy?, decidedById?`, with `@@index([status, submittedAt])` and `@@index([customerId, status])`.

- [ ] **Step 1:** Add the model. `pendingCustomerId` is set to `customerId` only while Pending and cleared on decision, which makes "one waiting request per customer" a database rule (same pattern as `CustomerRequest.pendingPhone`). Comment `photoUrl` as "base64; never select into a list; cleared on approval".
- [ ] **Step 2:** Run `npx prisma migrate dev --name customer_photo_requests` in the worktree. Expected: a new folder in `prisma/migrations/` with only `CREATE TABLE` and `CREATE INDEX` statements (additive).
- [ ] **Step 3:** Run `npx tsc --noEmit 2>&1 | grep -c "error TS"`. Expected: 23.
- [ ] **Step 4:** Commit: `feat: table for customer photos waiting for the super admin's check`.

### Task 2: Deadline and block rules (pure)

**Files:**
- Create: `src/lib/photo-deadline.ts`
- Test: `tests/photo-deadline.test.ts`

**Interfaces:**
- Produces:
  - `PHOTO_DEADLINE_KEY = 'photoDeadline'`
  - `deadlineFromGoLive(goLive: Date): Date`
  - `type PhotoPhase = 'none' | 'green' | 'yellow' | 'red' | 'paused'`
  - `photoPhase(deadline: Date | null, now: Date): PhotoPhase`. Returns `none` when there's no deadline. Before the deadline it's red within 24 h, yellow within 48 h, otherwise green. At or after the deadline it's `paused`.
  - `photoBlockMessage(o: { hasPhoto: boolean; deadline: Date | null; now: Date; who: 'customer' | 'agent'; firstName: string }): string | null`
  - `type PhotoStatus = 'ok' | 'missing' | 'pending' | 'rejected'`
  - `photoStatusOf(hasPhoto: boolean, latestRequest: { status: string; rejectReason: string | null } | null): { status: PhotoStatus; rejectReason: string | null }`. If there's a photo, the status is `ok`, whatever the request says.
  - `getPhotoDeadline(client: Pick<PrismaClient, 'platformSetting'>): Promise<Date | null>`. An invalid stored value reads as null.
  - `photoSaveBlock(client: PrismaClient, customerId: string, who: 'customer' | 'agent', now?: Date): Promise<string | null>`. Loads only `photoUrl` presence and `firstName`.
  - `PHOTO_REQUIRED = 'PHOTO_REQUIRED'` and `photoBlockedResponse(message: string): NextResponse` (403 with that code).

- [ ] **Step 1: Write the failing tests**

```ts
test('deadline is 00:00 WAT starting the 4th day; go-live day is day 1', () => {
  // 13 Nov 2026 10:00 WAT = 09:00Z
  assert.equal(deadlineFromGoLive(new Date('2026-11-13T09:00:00Z')).toISOString(), '2026-11-15T23:00:00.000Z')
  // 23:30 WAT on 13 Nov is still day 1 (22:30Z)
  assert.equal(deadlineFromGoLive(new Date('2026-11-13T22:30:00Z')).toISOString(), '2026-11-15T23:00:00.000Z')
  // 00:30 WAT on 14 Nov (23:30Z on the 13th) is day 1 of a later go-live
  assert.equal(deadlineFromGoLive(new Date('2026-11-13T23:30:00Z')).toISOString(), '2026-11-16T23:00:00.000Z')
})
test('phase by time left', () => {
  const d = new Date('2026-11-15T23:00:00Z')
  assert.equal(photoPhase(null, new Date()), 'none')
  assert.equal(photoPhase(d, new Date('2026-11-13T09:00:00Z')), 'green')
  assert.equal(photoPhase(d, new Date('2026-11-14T12:00:00Z')), 'yellow')
  assert.equal(photoPhase(d, new Date('2026-11-15T12:00:00Z')), 'red')
  assert.equal(photoPhase(d, d), 'paused')
})
test('block only after the deadline and only without a photo', () => {
  const deadline = new Date('2026-11-15T23:00:00Z'), after = new Date('2026-11-16T08:00:00Z')
  assert.equal(photoBlockMessage({ hasPhoto: false, deadline, now: new Date('2026-11-15T22:59:00Z'), who: 'agent', firstName: 'Ada' }), null)
  assert.equal(photoBlockMessage({ hasPhoto: true, deadline, now: after, who: 'agent', firstName: 'Ada' }), null)
  assert.equal(photoBlockMessage({ hasPhoto: false, deadline: null, now: after, who: 'agent', firstName: 'Ada' }), null)
  assert.equal(photoBlockMessage({ hasPhoto: false, deadline, now: after, who: 'agent', firstName: 'Ada' }), 'Saving is paused until Ada’s photo is added.')
  assert.equal(photoBlockMessage({ hasPhoto: false, deadline, now: after, who: 'customer', firstName: 'Ada' }), 'Saving is paused until you add your photo.')
})
test('status: a photo wins; otherwise the latest request decides', () => {
  assert.deepEqual(photoStatusOf(true, { status: 'Rejected', rejectReason: 'x' }), { status: 'ok', rejectReason: null })
  assert.deepEqual(photoStatusOf(false, null), { status: 'missing', rejectReason: null })
  assert.deepEqual(photoStatusOf(false, { status: 'Pending', rejectReason: null }), { status: 'pending', rejectReason: null })
  assert.deepEqual(photoStatusOf(false, { status: 'Rejected', rejectReason: 'Blurred' }), { status: 'rejected', rejectReason: 'Blurred' })
})
```

- [ ] **Step 2:** Run `npx tsx --test tests/photo-deadline.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `src/lib/photo-deadline.ts`. The WAT day comes from `new Date(t + 3600e3)` read in UTC fields. The deadline is `Date.UTC(y, m, d + 3) - 3600e3`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: rules for the photo deadline, its colour by day, and when saving is paused`.

### Task 3: Block every way of starting a saving

**Files:**
- Modify: `src/app/api/transactions/saving/route.ts` and `src/app/api/transactions/saving/bulk/route.ts` (after the owned-customer lookup, `who: 'agent'`)
- Modify: `src/app/api/agent/ajo/[id]/contribution/route.ts` (after the member lookup. Add `customerId: true` to the member's customer select)
- Modify: `src/app/api/customer/transfer/init/route.ts`, `src/app/api/customer/catchup/init/route.ts`, `src/app/api/customer/paystack/init/route.ts`, `src/app/api/customer/ajo/[id]/transfer/route.ts` and `src/app/api/customer/auto-debit/init/route.ts` (after the session customer is known, `who: 'customer'`)
- Modify: `src/lib/auto-debit-run.ts` (in the `runDueAutoDebits` loop, skip a mandate whose customer is blocked, with `continue`. Don't record a failure or pause the mandate)
- Test: `tests/photo-block-sites.test.ts`, and add a case to `tests/saving-bulk.int.test.ts`

**Interfaces:**
- Consumes: `photoSaveBlock`, `photoBlockedResponse` from Task 2.

- [ ] **Step 1: Write the route-list tripwire** (`tests/photo-block-sites.test.ts`). For each of the 8 route files above and `src/lib/auto-debit-run.ts`, read the source and assert it contains `photoSaveBlock(`. Also assert that `src/app/api/cron/bank-alerts/route.ts` and the files under `src/lib` it imports for crediting do **not** contain `photoSaveBlock(` (Review Focus 2).
- [ ] **Step 2:** Run it. Expected: FAIL, listing the 9 files.
- [ ] **Step 3:** Add the call in each file: `const blocked = await photoSaveBlock(prisma, customer.id, '<who>'); if (blocked) return photoBlockedResponse(blocked)`. The bulk route must check before any write. In the auto-debit run, check per mandate.
- [ ] **Step 4: Add an integration case** in `tests/saving-bulk.int.test.ts`. Write `photoDeadline` as an ISO string 1 hour in the past, with the customer having no photo. Expect 403 with `code === 'PHOTO_REQUIRED'`. Then set `photoUrl` to the test JPEG data URL and repeat the same request: expect 200 (Review Focus 1). Delete the setting row in `after`.
- [ ] **Step 5:** Run `npx tsx --test tests/photo-block-sites.test.ts tests/saving-bulk.int.test.ts` in the worktree. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: after the photo deadline, nobody can start a saving for a customer with no photo (cash, bulk, Ajo, transfer, card, auto-debit); money already sent still credits`.

### Task 4: Agent photo submissions and review (logic and notifications)

**Files:**
- Create: `src/lib/customer-photo-request.ts`
- Modify: `src/lib/notifications.ts` (kinds `customer_photo_approved` and `customer_photo_rejected`, and builders), `src/lib/notification-sweep.ts` (rebuild both from requests decided in the window)
- Test: `tests/customer-photo-request.int.test.ts`

**Interfaces:**
- Produces:
  - `submitAgentPhoto(client: PrismaClient, i: { customerDbId: string; agent: { id: string; name: string; agentId: string }; photoUrl: string }): Promise<{ ok: true; requestId: string } | { ok: false; status: 400 | 404; error: string }>`. Ownership is in the `where` (`{ id, agentId }`). Requires a non-empty photo that passes `validatePhoto`. If a Pending request exists, update its `photoUrl` and `submittedAt`; otherwise create one with `pendingCustomerId = customerId`. Audit `customer_photo_submitted`.
  - `approvePhotoRequest(client, i: { id: string; admin: { id?: string; name: string } }): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }>`. In one transaction: conditional `updateMany({ where: { id, status: 'Pending' } })` to Approved, clearing `pendingCustomerId` and `photoUrl`. If the count is 0, return 409. Then set `Customer.photoUrl`, audit `customer_photo_approved`, and `notify(tx, notifications.customerPhotoApproved(...))`.
  - `rejectPhotoRequest(client, i: { id: string; admin: {...}; reason: string }): Promise<same>`. The reason is 3–300 characters (400 otherwise). Same conditional update to Rejected, clearing `pendingCustomerId` and `photoUrl`, with `rejectReason` saved. Audit, and `notify` `customerPhotoRejected`.
  - `notifications.customerPhotoApproved(f: { id: string; agentId: string; customerName: string })`: title `"{Name}'s photo was approved"`, body `"Saving for them works again."`, href `/dashboard/customers`, dedupe `customer-photo-approved:{id}`.
  - `notifications.customerPhotoRejected(f: { id; agentId; customerName; decidedAt: Date })`: title `"{Name}'s photo was rejected"`, body `"See why, then take a new photo."`, dedupe `customer-photo-rejected:{id}:{decidedAt ms}`. Never put the reason text in the notification body; the screens show it.

- [ ] **Step 1: Write failing integration tests:**
  - `submit twice keeps one waiting request with the newer photo` (Review Focus 3): count Pending for the customer is 1, and its `photoUrl` equals the second photo.
  - `another agent's customer is 404`.
  - `approve moves the photo onto the customer and clears it from the request`: `customer.photoUrl === photo`, `request.photoUrl === null`, `pendingCustomerId === null`, and one Notification with kind `customer_photo_approved`.
  - `approve twice: second is 409` and `reject after approve is 409` (Review Focus 4).
  - `reject needs a reason; the customer keeps no photo; agent can submit again afterwards`.
- [ ] **Step 2:** Run `npx tsx --test tests/customer-photo-request.int.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the module and the catalogue entries. Add the sweep reader alongside `customerRequests` in `notification-sweep.ts`.
- [ ] **Step 4:** Run `npx tsx --test tests/customer-photo-request.int.test.ts tests/notification-coverage.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: photos taken by agents wait for the super admin to approve or reject them; the agent is told either way`.

### Task 5: Routes for agents and the super admin

**Files:**
- Modify: `src/app/api/customers/[id]/photo/route.ts` (POST now calls `submitAgentPhoto` and returns `{ ok: true, status: 'pending' }`. It no longer writes `Customer.photoUrl`)
- Modify: `src/app/api/customers/route.ts` (GET adds `photoStatus` and `photoRejectReason` per customer from `photoStatusOf`, using one extra query for the latest request per listed customer)
- Create: `src/app/api/agent/photo-reminder/route.ts`. GET returns `{ deadline: string | null, phase: PhotoPhase, customers: { id, name, customerId, photoStatus, rejectReason }[] }` for the agent's `status: 'Active'` customers whose status isn't `ok`, or an empty list when `phase === 'none'`.
- Modify: `src/app/api/agent/ajo/[id]/route.ts` (each member gets `photoBlocked: boolean`)
- Create: `src/app/api/admin/customer-photos/route.ts` (GET, `customer-requests` view: Pending first, without `photoUrl`, with customer name/code, agent name and submittedAt). Also `[id]/route.ts` (GET with `photoUrl` and `currentPhotoHref` = existing `/api/admin/customers/{customerId}/photo` or null), `[id]/approve/route.ts` and `[id]/reject/route.ts` (POST, `customer-requests` manage)
- Modify: `src/app/api/admin/stats/route.ts` (add `pendingCustomerPhotos`)
- Test: extend `tests/customer-photo-request.int.test.ts` with a route-level case for the agent POST (it returns pending and leaves `Customer.photoUrl` unchanged)

**Interfaces:**
- Consumes: Task 2 status helpers, Task 4 functions.
- Produces: the endpoints above, which Tasks 7 and 8 use.

- [ ] **Step 1:** Write the failing route case. Run it. Expected: FAIL (the photo is written directly today).
- [ ] **Step 2:** Implement the routes, reading `node_modules/next/dist/docs/` for the route handler signature (`params` is a Promise). Use `guard.actor` for admin identity, as `customer-requests/[id]/deny` does.
- [ ] **Step 3:** Run the test file. Expected: PASS. Then run `npx tsc --noEmit 2>&1 | grep -c "error TS"`. Expected: 23.
- [ ] **Step 4:** Commit: `feat: agent photos go to review; super admin photo review routes; agent reminder list; blocked Ajo members flagged`.

### Task 6: Online customers add their own photo

**Files:**
- Create: `src/app/api/customer/photo/route.ts` (POST)
- Modify: `src/app/api/customer/me/route.ts` (add `photo: { status: PhotoStatus; rejectReason: string | null; deadline: string | null; phase: PhotoPhase; canTakeOwn: boolean; agentName: string }`, where `canTakeOwn = type === 'online' && !hasPhoto`. Keep the existing `photoUrl` field)
- Test: `tests/customer-photo-self.int.test.ts`

**Interfaces:**
- Produces: `POST /api/customer/photo { photoUrl }` → `{ ok: true }`. The server rules:
  - The customer must be `asCustomerType(customer.type) === 'online'` and have no photo yet; otherwise 403 with a plain message (Review Focus 5).
  - `validatePhoto` must pass and the photo must be non-empty.
  - A conditional `updateMany({ where: { id, OR: [{ photoUrl: null }, { photoUrl: '' }] } })` writes it, so two taps can't race.
  - Audit `customer_photo_self_added`.

- [ ] **Step 1:** Write failing tests:
  - An online customer with no photo gets 200 and the photo is stored.
  - An offline customer gets 403 and nothing is stored.
  - An online customer who already has a photo gets 403 and the photo is unchanged.
  - An empty photo is 400.
  - Call the handler with a signed `customer_token` cookie, the way `tests/customer-enroll-identity.int.test.ts` builds its auth.
- [ ] **Step 2:** Run. Expected: FAIL. Then implement, run again and expect PASS.
- [ ] **Step 3:** Commit: `feat: online customers can take their own photo in the app; it goes straight on`.

### Task 7: Customer app warnings and photo screen

**Files:**
- Create: `src/components/customer/PhotoReminder.tsx` (pop-up and Home banner, driven by `me.photo`)
- Create: `src/components/customer/TakeOwnPhoto.tsx` (live camera sheet that posts to `/api/customer/photo`. Reuse the sign-up camera's look: `cu-oval`, the shutter, the "Take it again" option. No file input)
- Modify: `src/app/customer/layout.tsx` (mount the pop-up, skipping the same public routes as `AnnouncementPopup`), `src/app/customer/dashboard/page.tsx` (banner), and `src/app/customer/save/page.tsx`, `src/app/customer/catchup/page.tsx` and `src/app/customer/ajo/[id]/page.tsx` (when `phase === 'paused'` and the status isn't `ok`, show the paused message and the right action in place of the pay button; also handle a 403 `PHOTO_REQUIRED` reply the same way)
- Modify: `src/app/globals.css` (classes `photo-remind--green|yellow|red`, using the page's existing success, warning and error colours)

**Copy (exact):**
- Days 1–3, can take own: title `Add your photo by {Sat 15 Nov}`, text `After that you won't be able to save until you do.`, button `Take my photo`.
- Days 1–3, offline: the same title. Text `After that you won't be able to save until you do. Ask your agent, {agentName}, to take it for you.` No camera button.
- Status pending: `Your photo is being checked.` After the deadline, add `Saving stays paused until it's approved.`
- Paused, can take own: title `Saving is paused`, text `Add your photo to save again.`, button `Take my photo`.
- Paused, offline: title `Saving is paused`, text `Ask your agent, {agentName}, to take your photo.`
- The date is the last day the customer can still save (deadline minus 1 ms, in WAT), formatted like `Sat 15 Nov`.

- [ ] **Step 1:** Build the components. The pop-up shows once per app open: keep the dismissed flag in `sessionStorage` wrapped in try/catch, so a new app open shows it again. After a successful photo, refresh `me` so the pop-up, banner and paused states clear at once.
- [ ] **Step 2:** Check at 360px in the worktree on port 3001, following the memory recipe `ui-check-recipe`. Seed an online and an offline customer with no photo, and set `photoDeadline` 2 h ahead (red), then 1 h behind (paused). Check the pop-up, the banner, the camera sheet, the Save page paused state, and that saving works after taking the photo.
- [ ] **Step 3:** Commit: `feat: customers see a coloured photo reminder and can take their photo; Save, Catch up and Ajo show when saving is paused`.

### Task 8: Agent app warnings, marks and blocked states

**Files:**
- Create: `src/components/agent/PhotoReminderPopup.tsx` (reads `/api/agent/photo-reminder`. Lists customers with status and a `Take photo` button, which opens `RetakePhotoSheet`. Same colour and open/close rules as Task 7)
- Modify: `src/app/dashboard/layout.tsx` (mount it next to `AnnouncementPopup`)
- Modify: `src/components/agent/RetakePhotoSheet.tsx` (after a successful submit, show `Sent for checking`. `onSaved` becomes `onSubmitted(): void`, since no photo comes back. Update its caller in `src/app/dashboard/customers/page.tsx`)
- Modify: `src/app/dashboard/customers/page.tsx` (a mark on each customer whose `photoStatus` isn't `ok`: `No photo`, `Photo being checked` or `Photo rejected: {reason}`. The same mark goes in the detail view, with `Take photo`)
- Modify: `src/app/dashboard/savings/page.tsx` (Record savings and Bulk Savings: when the chosen customer is blocked, either from list data or a 403 `PHOTO_REQUIRED`, show `Saving is paused until {firstName}'s photo is added.` with `Take photo`, in place of the save button)
- Modify: `src/app/dashboard/ajo/[id]/page.tsx` (members with `photoBlocked` show `Can't pay: no photo`. The cash-take action for them shows the same paused message)

**Copy (exact):**
- Pop-up title, days 1–3: `{n} customers need a photo by {Sat 15 Nov}`. Text: `After that, you can't record savings for them until their photo is approved.`
- Pop-up title, paused: `Saving is paused for {n} customers`. Text: `Take their photos. Saving starts again when each one is approved.`
- When `n` is 1, use "customer" (singular).

- [ ] **Step 1:** Build it. Note: `src/app/dashboard/savings/page.tsx` has uncommitted Bulk Savings changes in the main folder from another session. Build on the worktree's committed version and leave that work alone; mention it at merge.
- [ ] **Step 2:** Check at 360px: the pop-up with 1 and with several customers, the list marks, a rejected reason that wraps, Record savings blocked, and the Ajo member flag. Submit a photo and confirm `Sent for checking` and the `Photo being checked` mark.
- [ ] **Step 3:** Commit: `feat: agents see which customers need a photo, can take it, and see when saving for one is paused`.

### Task 9: Super admin photo review screen

**Files:**
- Modify: `src/app/superadmin/customer-requests/page.tsx` (two tabs, `Registrations` (today's list) and `Photos`. The Photos list shows customer, agent and time. Opening one shows the new photo large beside the current photo, or "No photo yet", with `Approve` and `Reject`. Reject asks for `What's wrong with the photo?` (required, 3–300 characters))
- Modify: `src/app/superadmin/_components/AdminShell.tsx` (the badge shows `pendingCustomerRequests + pendingCustomerPhotos`)
- Modify: `src/app/superadmin/admin.css` if needed

- [ ] **Step 1:** Build it, with loading, empty ("No photos waiting") and error states. Hide the buttons for view-only staff, using the page's existing permission handling.
- [ ] **Step 2:** Check at 360px and at desktop width: approve one, reject one with a reason, and confirm the badge count drops and the agent's mark changes.
- [ ] **Step 3:** Commit: `feat: super admin approves or rejects agents' customer photos from Customer requests`.

### Task 10: Starting the clock

**Files:**
- Create: `scripts/start-photo-deadline.ts`. It writes `photoDeadline = deadlineFromGoLive(new Date())` only if no row exists, then prints the deadline in WAT and how many customers have no photo. A `--dry-run` flag prints without writing.

- [ ] **Step 1:** Run `npx tsx scripts/start-photo-deadline.ts --dry-run` in the worktree. Expected: it prints a deadline 3 days ahead at 00:00 WAT, and a count.
- [ ] **Step 2:** Run the full unit tests, `npx tsc --noEmit` (expect 23 errors), and `npm run build` (expect success).
- [ ] **Step 3:** Commit: `chore: script that starts the 3-day photo clock at go-live`.
- [ ] **Step 4: Release (owner approves):** merge onto the latest `main` and deploy main's tip (the migration is additive, and deploy runs `migrate deploy`). Then the user runs the script on the server, or approves running it. The 3 days start then. Confirm on live that the pop-ups appear and that a test request shows `PHOTO_REQUIRED` only after the deadline.
