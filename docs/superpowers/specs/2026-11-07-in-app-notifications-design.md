# In-app notifications (agents and customers) — design

Date: 2026-11-07. Status: draft for owner approval. Owner asked Claude to decide the design for middle-aged users who are
not confident with technology, built for the Flutter WebView apps first.

## Why

Today agents and customers only learn what happened through SMS/email (and chat). Nothing in the app shows "your
₦2,000 was saved", "your collection was paid" or "a customer wants to collect". People who are unsure with phones
need one obvious, calm place to check, in plain words.

## Goals
- One bell, one list, for each agent and each customer (online and cash), showing the moments that matter for their money.
- Readable at a glance: one short sentence per item, big text, clear icons, no jargon.
- Works inside the phone apps (WebView): no hover, large tap targets, keyboard never involved.

## Non-goals (v1)
- Phone push notifications (needs Firebase in both Flutter apps and new app-store releases) — a later step that can reuse this table.
- Super admin notifications, marketing messages, per-type on/off settings.
- Replacing SMS/email: those keep going as now (item 7 of the batch changes who gets which).

## Anti-goals (failure even if it works)
- A notification ever showing a collection code, OTP or password.
- A notification failing and blocking or undoing a deposit, payout or sign-in.
- A list that needs managing (marking read, deleting, filters) — too much for this audience.

## What people see (Claude's calls)

**The bell.** Top-right of the agent top bar (every agent screen) and of the customer Home header. 48px tap target.
A red badge shows how many are new: 1–9, then "9+". Read aloud as "Notifications, 3 new".
Customers don't get a sixth bottom tab — the bottom bar is already full.

**The list** (its own screen, not a dropdown — easier on a small phone): title "Notifications", back arrow.
- Two groups: **New** and **Earlier**.
- Each row: a coloured round icon (green money in, blue collection/payout, amber needs attention, red security),
  a bold one-line sentence, a second line with detail, and a plain time ("Today, 2:15 pm", "Yesterday", "3 Nov").
- The whole row is tappable and opens the screen it is about (e.g. the collection, the plan, the customer).
- **Opening the list clears the badge.** No "mark as read" buttons. New items keep a dot and a soft highlight for that visit.
- Empty: "Nothing yet. We'll show you here when money comes in or a plan changes."
- Loading and error states as on other screens (error: "Couldn't load. Check your connection." + Try again).
- Shows the latest 50; items older than 90 days are not shown.

**Freshness.** The badge refreshes when a screen opens, when the app comes back to the front, and every 60 seconds while open.

## Events in v1

Wording is final copy; ₦ amounts formatted as elsewhere.

| For | When | Title | Opens |
|---|---|---|---|
| Customer | money reaches a plan (agent cash, bank transfer credited, staff credit by hand) | "₦2,000 saved into School Fees" | Home on that plan |
| Customer | collection asked for (by them or their agent) | "Your collection request was sent" | Collect |
| Customer | collection approved | "Your collection was approved" | Collect |
| Customer | payout done (cash handed over or bank transfer sent) | "₦18,500 has been paid to you" | Collect |
| Customer | collection declined | "Your collection request was declined" + reason | Collect |
| Customer | plan ends in 7 days (once) | "Your School Fees plan ends on 12 Dec" | Home |
| Customer | plan end date reached (once) | "Your School Fees plan has ended. You can collect it now." | Collect |
| Customer (online) | new sign-in | "Someone signed in to your account" + time | Settings |
| Agent | one of their online customers saves by transfer | "Ngozi Eze saved ₦2,000 by transfer" | Customer |
| Agent | a customer asks to collect and it needs the agent | "Ngozi Eze wants to collect ₦18,500" | Collections |
| Agent | office approves / declines / pays a collection | "Ngozi Eze's collection was approved" (etc.) | Collections |
| Agent | wallet top-up credited | "₦50,000 added to your wallet" | Wallet |
| Agent | withdrawal approved / paid / declined | "Your withdrawal of ₦20,000 was paid" (etc.) | Withdraw |
| Agent | daily, if any of their customers' plans end within 7 days | "3 customers' plans end this week" | Collections |
| Agent | new sign-in | "Someone signed in to your account" + time | Settings |

Each event is written at the same place the existing email/SMS for it is sent (payment-alert, customer-settle,
agent-settle, payout-notify, redemption routes, login-alert), plus the daily cron for the two time-based ones.

## Data and API (owner chose "write at the moment it happens", with safeguards — 2026-11-07)

- New table `Notification`: `id, recipientType ('agent'|'customer'), recipientId, kind, title, body?, href?, createdAt, dedupeKey (unique)`,
  index `(recipientType, recipientId, createdAt)`; plus `Agent.notificationsSeenAt` and `Customer.notificationsSeenAt` (badge = newer than this).
  **Additive migration**, applied by the normal deploy (`migrate deploy`); no `ALLOW_DB_PUSH`.
- **Safeguard 1 — one catalogue.** `src/lib/notifications.ts` holds every kind, its recipient and its exact wording. Code calls typed
  helpers, never free text, so no code/OTP can leak into a message.
- **Safeguard 2 — same database step.** The notification is written inside the same transaction as the change it describes, as an
  upsert on `dedupeKey` (e.g. `collection-paid:<id>`), so it exists exactly when the change exists and retries never duplicate it.
- **Safeguard 3 — tripwire test.** `tests/notification-coverage.test.ts` scans `src/` for every write that changes a collection or
  withdrawal, credits a plan or funds a wallet, and fails unless that spot calls the catalogue or carries
  `// notify: none — <reason>`. New money paths can't ship silently.
- **Safeguard 4 — nightly safety net.** The daily cron re-derives the last 48 hours of deposits, collections, withdrawals and top-ups and
  creates any notification that is missing (same dedupe keys, so it never duplicates), logging how many it had to add.
  It also creates the time-based ones (plan ending in 7 days, plan ended, agent "plans end this week").
- **Safeguard 5 — written rule.** `.claude/rules/backend-api.md` states the rule and points at the tripwire.
- Sign-in alert: "Your account was opened on a new phone", written where a new DeviceSession is created.
- API: `/api/agent/notifications` and `/api/customer/notifications` (GET list or `?count=1`, POST seen). Recipient only from the session.

## Tests
- Unit: copy builders per kind (amounts, names, no codes), time labels, dedupe behaviour of `notify` against a stub, badge text (0 hidden, 9+).
- Route: recipient isolation (an agent can't read a customer's, and vice versa).
- Browser at 360px in both apps: bell + badge, list groups, tap-through, empty/error states, badge clears on open.

## Left to the builder
Icon choice per kind from the existing icon set; exact spacing within the existing CSS.
