# Customer photo deadline — design

Date: 2026-11-12. Status: waiting for the owner's approval.

## Why

The code we inherited threw away customer photos at registration. That is fixed, and new customers must now give a photo
(232d6da), but most existing customers have none. The owner needs a photo on every account so staff and agents can recognise
who they're dealing with. To get the missing ones in, each affected customer gets three days of clear warnings. After that,
nobody can save money for them until a photo is on the account.

## Goals

- Every existing customer without a photo gets one, within three days of go-live or soon after.
- Everyone affected sees the warning and what happens if nothing is done: online customers, offline (cash) customers who
  sign in, and agents.
- After the deadline, every way of putting savings in for a customer with no photo is blocked on the server. That covers
  the agent recording cash, Bulk Savings, Ajo payments, and the customer starting a bank transfer or card payment.
- Photos taken by agents are checked by the super admin before they go on the account.

## Non-goals

- Changing a photo a customer already has. Online customers can only add a photo when they have none. Agents can still
  replace one, through review.
- Liveness or face matching. The camera-only rule is a screen rule, as it is today (`src/lib/photo.ts` explains why).
- Texts or emails about the deadline. SMS costs money, and the owner decides any new SMS. The warnings are in the apps only.
- Blocking withdrawals, redemptions, collections or anything else that pays money out.

## Anti-goals (would be a failure even if it "works")

- Money a customer already sent arriving and not being credited. A bank transfer started before the block, and matched
  later by the bank-alert cron, must still credit normally. So must staff crediting held money by hand. The block stops
  *starting* a payment, never *receiving* one.
- A customer blocked with no way out. Each blocked person must see exactly what to do: take your photo, or ask your agent.
- A customer blocked while staff think they're fine. The admin, agent and customer must all see the same state.
- A pop-up that can't be closed. It must always be dismissible. It comes back on the next app open or sign-in.

## Who adds the photo

| Customer | Who takes it | Where it goes |
|---|---|---|
| Online (registered themselves) | The customer, live camera only (no file upload) | Straight onto the account |
| Online | Their agent | Super-admin review |
| Offline (registered by an agent) | Their agent only. The customer is told to ask their agent | Super-admin review |

Online and offline mean what `src/lib/customer-type.ts` says at build time. That work, storing the type on the customer, is
in progress. Use whatever the current helper is.

## The deadline

- One deadline for everyone: the end of the third day after go-live, in Lagos time (WAT). For example, if it goes live on
  Thursday 13 Nov, day 1 is Thursday (green), day 2 is Friday (yellow) and day 3 is Saturday (red). Saving is blocked from
  00:00 WAT on Sunday 16 Nov.
- It's stored once, as a `PlatformSetting` row (for example key `photoDeadline`, value an ISO timestamp), written at
  go-live. With no row, nothing warns and nothing blocks, so the code can ship before the clock starts. **Builder's call:**
  how the row gets written (a one-off script run at deploy, or the first request after deploy). The owner said "from
  today", which we read as from go-live.
- A customer is **missing a photo** when `Customer.photoUrl` is empty. A photo waiting for review does **not** count: the
  customer stays blocked until it's approved (owner's decision).
- Customers registered after go-live already have a photo, because registration requires one.

## The warnings

Colour by the day (owner's rule): day 1 green, day 2 yellow, day 3 red. After the deadline it stays red and the wording
changes to "Saving is paused".

**Online customer (customer app):**
- A pop-up each time the app opens or they sign in, until a photo is on the account. It can always be closed. Wording, for
  example: "Add your photo by Sat 15 Nov. After that you won't be able to save until you do." Button: **Take my photo**,
  which opens the live camera (reuse the sign-up camera screen's look and behaviour). The photo goes straight on, the
  warning disappears, and saving works again at once.
- After the pop-up is closed, a banner stays on Home in the same colour, so the warning never fully disappears.
- After the deadline, Save, Catch up and the Ajo pay screens show the paused message with the same button. Don't just let a
  button fail.

**Offline customer (if they sign in):** the same pop-up and banner, but the action is "Ask your agent, [agent name], to take
your photo". There's no camera button. If their agent has submitted a photo that's waiting for review, say so: "Your photo
is being checked."

**Agent (agent app):**
- A pop-up at sign-in and each time the app opens while any of their customers is missing a photo. It lists those customers,
  with the deadline and a **Take photo** button on each. Its colour follows the same day rule. It can be closed and comes
  back next time.
- In the customer list and the customer's details: a mark on each customer missing a photo, reading "No photo", "Photo
  being checked" or "Photo rejected: [reason]".
- Record savings, Bulk Savings and the Ajo cash screen: a blocked customer is shown as blocked, with **Take photo**, instead
  of the save failing at the end.
- Uses the existing camera-only retake sheet (`src/components/agent/RetakePhotoSheet.tsx`). After submitting, it shows
  "Sent for checking".

**Super admin:** waiting photos appear under the existing **Customer requests** screen, as a second list or tab next to
registrations. The menu badge counts both. This badge is "notified via admin".

## Photo review (agent-taken photos)

- A new request record, separate from `CustomerRequest`. That one is for new registrations and has no customer yet. It
  holds: customer, agent, photo (base64; never selected into lists), status Pending/Approved/Rejected, reject reason,
  decided-by and decided-at, and submitted-at.
- At most one Pending per customer. A new submission replaces the waiting one.
- Only the customer's own agent can submit (owner check in the `where`, as today). Every agent submission goes to review,
  including replacing an existing photo. The old photo stays until the new one is approved.
- The super admin sees the photo beside the customer's details, including their current photo if they have one, then:
  - **Approve:** the photo moves onto `Customer.photoUrl` and is cleared from the request, as registration requests do.
    Saving unblocks at once.
  - **Reject:** a reason is required (for example "Face is blurred" or "Not the customer"). The agent sees it on the
    customer and in a notification, and takes a new photo.
- Permission: the existing `customer-requests` screen permission (view to see, manage to decide). Every submit, approve and
  reject is audited with `logAudit`.
- Notifications through the catalogue (`src/lib/notifications.ts`) and the nightly sweep, as the rules require: the agent
  is told on approve and on reject. Mark the writes for the tripwire test.

## The block (server side)

One shared check, for example `photoBlock(customer, now)` in `src/lib`, returns the message or nothing. Every place that
*starts* putting savings in calls it, after loading the customer and before any write:

- Agent cash save: `api/transactions/saving` and `api/transactions/saving/bulk`
- Agent Ajo cash payment: `api/agent/ajo/[id]/contribution`
- Customer bank transfer or card: `api/customer/transfer/init`, `api/customer/catchup/init`, `api/customer/paystack/init`,
  `api/customer/ajo/[id]/transfer`, `api/customer/auto-debit/init`
- Scheduled auto-debit charges in `api/cron/daily`: skip a blocked customer's charge. Don't count it as a failure that
  cancels their mandate.

**Builder's call:** whether to put the check inside the shared helpers (for example `createPaymentIntent`, which agent
wallet top-ups also use, so it needs care) or route by route. Either way, a test must fail if a listed route stops checking.

Ajo is blocked too (owner's decision, 2026-11-12), knowing that one blocked member holds up the whole group's turn until
their photo is approved. To help the group sort it out, the agent's Ajo group screen should name the members who are
blocked and say why, so the others can see what's holding the turn up.

Not blocked: matching incoming bank alerts to earlier transfers, staff crediting held money by hand, redemptions, Ajo
payouts, and plan creation.

The error message is plain and says what to do, for example "Saving is paused until [name]'s photo is added." The screens
show it with the photo action.

## What's left to the builder

- Exact component structure, and the CSS within the existing styles (`globals.css`). Check at 360px, including the
  pop-ups.
- How the deadline row is written at go-live.
- Whether the customer's own photo route lives in `api/customer/me` or a new `api/customer/photo`. It must be camera-only
  on screen, use `validatePhoto` on the server, and accept a photo only from an online customer with no photo.
- Which list endpoints need a `photoStatus` field (none, pending, rejected or ok) so screens don't load base64.

## Calls I made (owner to check)

1. The deadline is three days from **go-live**, not from 12 Nov, so nobody loses warning days if it ships later.
2. Online customers can add a photo only when they have none. Changing an existing photo is the agent's job, through review.
3. Every photo an agent takes goes to review, including replacing an existing one. The old photo stays until approved.
4. The banner stays on Home after the pop-up is closed.
5. No texts or emails about the deadline.
6. Only the agent is notified when a photo is approved or rejected, not the customer.
7. Card payments and auto-debit are blocked too, though they're switched off today, so they're covered if they come back.
8. The agent's Ajo group screen names blocked members, so a stalled turn has a visible reason.
9. The agent's pop-up lists only their active customers (not closed accounts).
