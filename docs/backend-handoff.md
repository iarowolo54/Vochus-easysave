# Backend changes needed (handoff from the UI work)

**Status (2026-10-30):** items 1–11 and 13–18 are done on `main` and merged into `ui/zopa-standard`. Item 12 (notification settings) is not done — only needed if agents should control notifications. Items 19–23 came out of the admin redesign and are open. **Items 24–26 are new:** 24–25 the two kinds of customer (cash savers vs online) on the agent and admin Customers pages; 26 the next interest credit on the customer home.

The UI for everything below is done on `ui/zopa-standard`. Please don't change the request or response shape of `/api/customer/enroll` — the UI depends on it. Every change below is backend-only unless it says otherwise.

## Done (for reference)
1. Phone-available check before the last enrol step — **done**, wired into the UI.
2. Enrol requires a confirmed email — **done**.
3. Email codes use `crypto.randomInt`, with an attempt limit — **done**.
4. Email-code sending is throttled — **done**, the UI shows the messages and a 60s resend countdown.
5. Invite info for the welcome screen — **done**, the UI shows "Invited by …, your agent in …".

## 6. Custom start dates for customers — **done**, UI wired (sign-up and the customer Save page send `startDate`)
`POST /api/customer/enroll` (each plan) and `POST /api/customer/plan` always start the plan today. Agents can already choose a start date via `/api/customers/plan` and `/api/customers`.
- Accept an optional `startDate` ("yyyy-mm-dd", today or later) on both customer routes and work out `maturityDate` from it.
- Custom end dates already work everywhere: the UI sends the length as `periodDays`.
- Tell the UI side when it ships: the customer plan screens currently say "Your plan starts today".

## 7. Allow several plans with the same start date — **done**, UI wired (Record saving sends `planId`; customers with several active plans must pick one)
`SavingsPlan` has a unique index on (customerId, startDate). It isn't a real duplicate guard (plans starting "today" carry millisecond timestamps), but it makes two plans with the same chosen start date fail with a database error / 500. Do these together, in this order:
1. Make every route that adds money to a plan take an explicit `planId`, check it belongs to that customer and is Active, and stop choosing "the newest plan by start date": `POST /api/transactions/saving`, `POST /api/transactions/saving/bulk`, and the Paystack webhook fallback (`api/webhooks/paystack`, when `meta.planId` is missing). This also fixes today's behaviour where, for customers with several active plans, every agent-recorded saving goes to the most recently started plan.
2. Drop the unique index with a new forward-only migration. Remove the add-1-second workaround in `api/customer/enroll` and `api/customers`.
3. Update `prisma/seed.ts`, which upserts plans by `uniq_plan_per_start`, to find its demo plans another way (for example customer + goal). Deploys run the seed, so they'd otherwise break or duplicate demo plans.
4. For real duplicate protection, use an idempotency key on plan creation. The UI already disables the button while a request is in flight.
- Tell the UI side when step 1 ships: Record saving needs a "which plan?" picker for customers with more than one active plan.

## 8. Camera-only photos are only enforced in the app — **done (interim)**: `validatePhoto` checks type and size; liveness still open
The UI now accepts only a photo taken with the camera at that moment (no gallery upload), in both customer and agent enrolment. The APIs still accept any image in `photoUrl`, so a direct API call could send a gallery photo. A real live-photo guarantee needs a server-side check, such as a liveness or selfie-verification provider.

## 9. Schema changes on `main` have no migrations — **handled by runbook** (`docs/migration-baseline.md`); baseline to be done deliberately
The hardening batch on `main` changed `prisma/schema.prisma` — `EmailOTP.attempts`, and new `LoginAttempt`, `AccountUnlockOtp` and `PaymentIntent` models — but added no files under `prisma/migrations/`. The project rule (`.claude/rules/database.md`) is one forward-only migration per schema change.
- Item 7 also removed `@@unique([customerId, startDate])` from the schema with no migration. Existing databases (including local dev ones) keep that index until something drops it, so two plans with the same chosen start date will still fail there.
- Add a migration covering these changes (`npx prisma migrate dev --name <what>` against a copy of the data, then commit the generated SQL).
- Until then, any existing database only gets them through `prisma db push`. Production gets them via the deploy's `db push --accept-data-loss`, which is the known risk noted in `database.md`. Local dev databases need a manual `npx prisma db push`.

## 10. Sub-agents: validate input and handle duplicate phones — **done**
`POST /api/subagents` spreads `name`, `phone`, `location` straight into `prisma.subAgent.create` with no checks. `SubAgent.phone` is unique, so a phone already used (by any agent's sub-agent) throws and returns a 500.
- Validate: name and location required, phone 11 digits starting with `0`. Return `400 { error }`.
- Catch the unique-constraint error and return `409 { error: 'This phone number is already registered as a sub-agent' }`.
- Note: money given to a sub-agent (`PATCH /api/subagents/[id]/fund`) can't be taken back — there's no reclaim route. If agents need that, it's a new endpoint (atomic, audited).

## 11. Agents can't change their password while signed in — **done**, UI wired in Settings
There's no endpoint for an agent to change their password with the current one (only the forgot-password reset flow). The old Settings page had a password form that wasn't connected to anything; the new one links to `/forgot-password` instead.
- Add `POST /api/agent/password` `{ currentPassword, newPassword }` (verify current, min length, hash, audit). Tell the UI side and Settings will get a proper form.

## 12. Notification preferences don't exist — **NOT DONE** (only needed if you want agents to control notifications)
The old Settings page showed Email / SMS / Daily report switches that were hard-coded and saved nothing; they've been removed. If agents should control notifications, it needs fields on `Agent` (or a settings table), `GET/PATCH` routes, and the senders to respect them.

## 13. Document approval sends no email — **done**
`superadmin/agents/[id]/documents/approve` emails the agent on **reject** only. Approving sends nothing, so the agent only finds out by opening the app. If you want an "approved" email (or one when all documents are approved and the account opens), add it there.

## 14. Agent chat shows the oldest 100 messages — **done**, merged, so new ones disappear in long chats
`GET /api/agent/customer-chat?customerId=…` uses `orderBy: { createdAt: 'asc' }, take: 100`, which returns the **first** 100 messages ever sent. Once a conversation passes 100 messages, every newer message is missing from the agent's screen.
- Fetch the latest 100 instead (`orderBy: { createdAt: 'desc' }, take: 100`, then reverse), or page with a `before` cursor if agents need older history.
- Check the customer-side chat route for the same pattern.

## 15. Agent chat list is slow and polled every 5 seconds — **done**, merged
The list (`GET /api/agent/customer-chat` with no `customerId`) runs two queries **per customer** the agent has (unread count + last message), and the agent page and the dashboard layout both poll it every 5 seconds. It also returns each customer's full `photoUrl` (base64) every time. With a few hundred customers this is hundreds of SQLite queries every few seconds per agent.
- Do it in one or two grouped queries (e.g. `groupBy` on `customerId` for unread counts; latest message per customer), only for customers who have messages, and select a small photo or none.

## 16. **Done**, merged — Member cards: blocked/expired cards can be linked, lookups leak names, and nothing can unlink
`/api/cards/[serial]`:
- **POST (link)** only refuses a card whose status is `Linked`. A `Blocked` or expired card (`expiryDate` in the past) can still be linked to a customer. Return `400` for both. (The agent UI now stops this too, but the server should be the guard.)
- **GET** returns the linked customer's full name and ID to *any* signed-in agent who types the serial, including another agent's customer. Only return customer details when the card's `agentId` is the calling agent.
- There's no route — for agents or admins — to unlink a card or move it to another customer. If a card is linked to the wrong person, nobody can fix it in the app. Add an admin-only unlink/relink (audited).

## 17. "ENR-" references can collide — **done**, merged
`POST /api/customers/plan` builds its ₦0 `enrolment` transaction ref as `ENR-${transaction.count() + 1}`. Two plans created at the same time get the same ref; if `Transaction.ref` is unique, the second request fails with a 500 after the plan is already created. Use a random or sequence-based ref (as the other `genId` helpers do).

## 18. Store gender, state and LGA on customers (gender is now required) — **done**, merged (incl. follow-up: required + LGA validated server-side)
Today none of these are saved. The `Customer` model has no `gender`, `state` or `lga` field. `POST /api/customer/enroll` reads `gender` from the body and drops it; `POST /api/customers` (agent Enrol) ignores the `state` the agent picks. Gender is needed for record keeping, so the UI now **requires** it in both registration flows (values: `"Female"` or `"Male"`).
- Add to `Customer`: `gender String?`, `state String?`, `lga String?` (nullable so existing customers stay valid). Apply per `docs/migration-baseline.md` — not a casual `migrate dev`.
- `POST /api/customer/enroll` and `POST /api/customers`: save `gender` (required for new customers; accept only `Female` / `Male`, else `400`), `state` (one of the 36 states + FCT) and `lga` (must be one of that state's LGAs).
- Return the three fields from `GET /api/customers` and `/api/customer/me` so agents and customers can see them.
- The UI now **requires and sends all three** from both flows: `gender` (`Female`/`Male`), `state` (one of the 36 states or `"FCT"`) and `lga` (an LGA of that state). The lists the UI uses are in `src/lib/ng-lgas.ts` (774 LGAs, counts checked against the Constitution's First Schedule) — validate against the same file server-side so the two can't drift.

## 19. Admin loan approve/reject don't check the loan is still pending — NEW (found during the admin redesign)
`PATCH /api/admin/loans/[id]/approve` (and `/reject`) update the loan by id with no status check. A loan that was already rejected, disbursed or repaid can be flipped back to `Approved` (or a disbursed loan to `Rejected`), e.g. from two admins acting at once or a stale tab.
- Update with a condition: `updateMany({ where: { id, status: 'Pending' }, data: … })` and return `409` ("This loan was already decided") when `count === 0`.
- Same for `reject`. The admin UI already shows the API's error message.

## 20. Admin agent detail returns password hashes and PINs — NEW, security
`GET /api/admin/agents/[id]/detail` uses `include` with no `select`, so the response carries every Agent and Customer column: password hashes, PIN hashes, biometric/device fields and base64 photos. Admin-only, but secrets must never be returned (`auth-security.md`).
- Switch to explicit `select`s with only what the page shows (the page's types are in `src/app/superadmin/agents/[id]/page.tsx`).

## 21. Payout races: money can move twice — NEW, money
Read-then-write status checks on real-money actions; two clicks or two admins can both pass:
- `api/admin/agent-withdrawal/[id]/route.ts` — approve can start two Paystack transfers. Also no limit on wrong PINs.
- `api/admin/agent-withdrawal/[id]/verify/route.ts` — the refund on a failed transfer can run twice.
- `api/admin/early-redemption/[id]/route.ts` — approve can pay out twice. Also no limit on wrong PINs.
- `api/admin/wallets/commission-payout/route.ts` — zeroes commission and debits Float with read-then-write (and sends the agent nothing; confirm that's intended).
- Fix: conditional `updateMany({ where: { id, status: 'Pending' } … })` / `{ commissionBalance: { gte } }` and check `count`, per `backend-api.md`; add attempt limits to the approval PIN.

## 22. Admin card unlink/relink can un-block a card — NEW
`PATCH /api/admin/cards/[serial]`: unlink and relink don't refuse `Blocked` or expired cards, so either silently makes a blocked card usable (the UI hides these actions for blocked cards). Relink doesn't check the customer already has a card. Audit uses `actorName: 'SuperAdmin'` instead of the real admin.

## 23. Smaller admin API gaps (found during the redesign) — NEW
- Audit entries from admin loan approve/reject and cards hardcode `actorName: 'SuperAdmin'` with no `actorId` — you can't tell which admin acted.
- List endpoints send base64 `photoUrl` for every row: `api/admin/customers`, `api/admin/wallets`, `api/admin/commission` (`database.md` says don't). `api/admin/customers` also has no limit/paging, and doesn't return `gender`/`state`/`lga` (the admin Customers page shows them when present).
- `api/admin/wallets/fund`: no type check or upper limit on `amount`; doesn't use `wallet-guard`. `api/admin/wallets` doesn't return `floatLimit` (Agent wallets shows "—").
- `api/admin/wallets/inject-capital`: the `reference` is ignored (not stored or audited) and no Transaction row is written.
- `api/admin/interest-rates` POST: `maxAmount` is accepted but ignored, and there's no on/off per term. The old Commission page had inputs for both that never saved; the redesign removed them. Add them to the API if you want them back.
- `api/admin/staff*`: no validation of `status`/`role`/email/password; missing id → 500. Staff accounts can't sign in at all (`auth-admin.ts` only signs in `superAdmin`), so roles/permissions are never enforced — the page now says so.
- `api/admin/early-redemption` GET: `pending` count excludes `AwaitingOTP`; `isEarly` is always true for active plans, so "after maturity" does nothing.
- `api/admin/loan-repayments`: date filter uses UTC midnight while "today" uses server local time; loads every repayment for totals. `api/admin/transactions` and `api/admin/audit`: hard cap of 200 with no paging.
- `api/admin/loan-disbursements`: no disbursed date (page shows the request date, labelled "Requested").
- 500s instead of 404/400: `admin/customers/[id]/status`, `admin/agents/[id]/reset-device`, `admin/rewards/[id]`, `admin/reports/[id]/status` (unparsed body). Rewards: no input checks or audit.
- Card codes on the back of printed cards (`cards/generate`) use `Math.random` and are never stored, so a batch can't be reprinted; the Cards page "PDF" prints a different design from the original print file.

## 24. Agent customer list: customer type, last paid and the collection summary — NEW (UI done, waiting on this)
Background: Vochus has two kinds of customer. **Online** customers are invited by email, register themselves (`api/customer/enroll`) and pay in the app. **Offline cash savers** are mostly market women with no email; the agent creates their account (`POST /api/customers`) and collects their cash by hand. The agent's Customers page now has "Cash savers" / "Online" tabs; the Cash savers tab is a morning collection round, overdue savers first. The UI only switches the tabs on once the fields below are present, so nothing breaks before this ships.

All of this is `GET /api/customers` (`src/app/api/customers/route.ts`, agent session). No schema change, no change to POST.

1. **`type: 'offline' | 'online'` on every customer.** Online if the customer has any plan with `source: 'self'`, otherwise offline. Never return `password` or any hash.
2. **`lastPaidAt: string | null` on every customer.** ISO date of the latest `type: 'saving'`, `status: 'Done'` transaction across all their plans, any method; `null` if never. One `transaction.groupBy` (`_max.createdAt`) for the page, not a query per customer.
3. **`?type=offline|online` filter**, applied in the `where` **before paging** so `total` is right for each tab (`savingsPlans: { some: { source: 'self' } }` / `none`). Same definition as #1 so the filter and the field never disagree. Missing or other value = no filter (today's behaviour).
4. **`?sort=lastPaid`**: never-paid first, then oldest last-paid first; ties by `createdAt` desc. Must apply before paging. For an agent's portfolio it's fine to fetch ids + last-paid for the filtered set, sort in memory, slice the page, then load those rows. No `sort` = today's order.
5. **`summary` when `type=offline`** (whole offline set, ignoring `search`/`page`/`limit`):
   - `overdueCount`: offline customers with an Active plan whose last Done saving is 3+ whole days ago (Africa/Lagos dates), or who never saved.
   - `expectedToday`: sum of `dailyAmount` over Active `cadence: 'daily'` plans of offline customers (weekly excluded), rounded with `money()`.
   - `saverCount`: offline customers with at least one Active plan.
   Leave `summary` out for other `type` values.
6. **Existing bug, same handler:** the `plan` (plan length) filter runs *after* paging (`result = result.filter(...)`), so pages come back short and `total` is wrong. Move it into the `where`: `savingsPlans: { some: { status: 'Active', periodDays: days } }`.

Keep every query scoped to `agentId: agent.id`; `where: any` can become `Prisma.CustomerWhereInput`.
**Check:** `?type=offline&sort=lastPaid&limit=10` returns only agent-created customers, never-paid first, with `summary`; `?type=online` returns only self-enrolled ones, no `summary`; every row has `type` and `lastPaidAt` and no `password`; with no new params the response is today's plus the two fields (the `?search=<cid>&limit=1` lookups in savings, loan-request and enrol must keep working).

## 25. Admin customer list: customer type and last paid — NEW (UI done on `ui/zopa-standard`, waiting on this)
The admin Customers page now has an "All types / Cash savers / Online" filter, a Last paid column (red for cash savers with a running plan who haven't paid in 3+ days) and an overdue count in the header. It switches on only when rows carry `type`, so nothing breaks before this ships.

`GET /api/admin/customers` (`src/app/api/admin/customers/route.ts`, `requireSuperAdmin`): add to **every row**
- `type: 'offline' | 'online'` and `lastPaidAt: string | null`, with **exactly the same definitions as #24**. Put the derivation in one shared helper (e.g. `src/lib/customer-type.ts`) used by both routes so they can't drift. `lastPaidAt` via one `transaction.groupBy` for all ids, not a query per customer.
- While there: drop `photoUrl` from the rows (base64, see #23) and add `gender`, `state`, `lga` (the detail panel already shows them when present).

**Keep returning the full list for now.** The page filters, counts and pages on the client, so adding server paging (see #23) at the same time would silently cut the list to one page and break the counts. Paging needs a matching UI change — do it as its own item and tell the UI side first.
**Check:** every row has `type` and `lastPaidAt`, no row has `photoUrl` or `password`; agent-created customers come back `offline`, self-enrolled `online`, same as `/api/customers` for the same customer.

## 26. Next interest credit on `/api/customer/me` — **done** (b1bb9c7), UI merged to `main` (066c7b0)
The customer dashboard now shows an "interest nudge" under the balance for **online (`source: 'self'`) plans**: "In 12 days you'll earn ₦1,500.00 more in interest — keep saving." It renders exactly what the API sends and shows nothing if a field is missing, so it is inert until this ships. `GET /api/customer/me` (`src/app/api/customer/me/route.ts`) already sends `interest` per plan (from `accruedInterestForPlan`); add two more fields to **each plan**, using the same interest code and `now` so the numbers agree:
- `nextInterestAmount: number` — naira credited at the plan's **next monthly anniversary** if the customer holds until then, rounded with `money()`. `0` when there is no upcoming credit: not a `self` plan, the next anniversary is after `maturityDate`, or the rate is 0.
- `daysToNextInterest: number | null` — whole days (Africa/Lagos calendar dates, not 24h blocks) from today to that anniversary; `0` if it lands today; `null` when there is no upcoming credit.
Rules: same anniversary clamping as accrual (31st → last day of a short month); base the amount on principal held now under the rate that will apply on that date (forward-only rate schedule); agent (`source: 'agent'`) plans always get `0` / `null`. Also make sure `source` stays in each plan's payload (it does today via the full row; keep it if you switch to a `select`).
**Check:** a self plan started 75 days ago with ₦150,000 principal at 12%/yr → `daysToNextInterest` = days until day 90, `nextInterestAmount` ≈ ₦1,500; an agent plan → `0` / `null`; a plan whose next anniversary is past maturity → `0` / `null`; extend the existing `/me` test.

## 27. Savings interest can be gamed by depositing just before an anniversary — NEW, money (flagged by security review, 2026-10-30)
`src/lib/savings-interest.ts` pays 1% (rate/12) on the **whole principal held at each monthly anniversary**, so a deposit made the day before an anniversary earns a full month's interest. An online saver can top up a large amount right before the anniversary, collect the month's interest, then redeem. This follows the owner-approved rule in `docs/superpowers/specs/2026-10-30-savings-features-design.md` ("applied to the whole deposit principal held at that moment"), so **it needs an owner decision**, not just a code fix. Options: count only money held for the whole month (minimum balance over the month), weight by days held, exclude deposits made within the accrual month, and/or forfeit interest on early redemption of online plans.

## 28. Not every agent password reset signs out old sessions — NEW, security (flagged by security review, 2026-10-30)
`POST /api/agent/password` increments `tokenVersion` (revoking existing sessions), but the other agent password paths (forgot-password reset, unlock reset, any admin reset) should do the same and also revoke `BiometricToken` rows. Put it in one shared `setAgentPassword` helper used by every path.

## 29. Loan tiers: `enabled` and `maxAmount` enforced — **done** (950666a); admin note removed. Agent loan screen still lists switched-off lengths (UI follow-up)

**✅ DONE 2026-10-31 — shipped to prod (main 950666a), TDD + code + security review.**
The super admin can now turn a loan length off and set a largest loan per length (`/api/admin/interest-rates`), but nothing reads those values:
- `POST /api/loans` looks up the tier by `durationDays` and uses its `rate` only. It should refuse a tier with `enabled: false` (400, "This loan length isn't offered right now") and refuse a principal above `maxAmount` when it is set (400, "The largest loan for N days is ₦X").
- `GET /api/interest-rates` (what the agent loan screen reads) returns disabled tiers too. Filter them out, or send `enabled` and `maxAmount` so the agent screen can hide or limit them.
The admin form shows a note saying these aren't enforced yet; remove it when this ships.

## 30. `/api/customer/me` pending redemptions miss AwaitingOTP and Finalizing — **done** (950666a)

**✅ DONE 2026-10-31 — shipped to prod (main 950666a), TDD + code + security review.**
`pendingRedemptions` filters `status in ['Pending','TokenValidated','AgentApproved']`. A collection that is mid-payout drops off the home screen tracker, and Save / New plan unlock while it is still in flight. Use `IN_FLIGHT_REDEMPTION_STATUSES` minus `Approved` (the tracker already maps AwaitingOTP and Finalizing to the last step).

## 31. Auto-debit verify: a successful charge with no `authorization` is not credited — **done** (950666a)

**✅ DONE 2026-10-31 — shipped to prod (main 950666a), TDD + code + security review.**
In `POST /api/customer/auto-debit/verify`, when Paystack reports `success` but sends no `authorization`, the route returns 400 "Card cannot be used for auto-debit" before the credit step, so the ₦50 first charge is taken from the card and never added to the plan (the intent stays pending). Credit it the same way as the non-reusable path (`savedInstead: true`). The callback screen currently tells the customer to contact support with the reference in this case.
