# Record Saving: "which plan?" picker needed (backend shipped)

Backend change on `main` affecting the **Record Saving** flow. The UI
(`ui/zopa-standard`) needs a small addition. This is the only UI change required.

## What changed on the backend
A customer can now have **several active savings plans** (the old
`(customerId, startDate)` unique constraint is gone, and plans may share a start
date). Previously every agent-recorded saving silently went to the customer's
**newest** plan — wrong for multi-plan customers. The money routes now require
the agent to say **which plan**:

- `POST /api/transactions/saving` and `POST /api/transactions/saving/bulk` accept
  an optional **`planId`** in the body.
- Resolution rules:
  - `planId` given → must belong to that customer and be `Active`, else
    `404 { error: "Plan not found for this customer" }`.
  - no `planId` + customer has **exactly one** active plan → uses it (unchanged UX).
  - no `planId` + customer has **more than one** active plan →
    `400 { error: "This customer has more than one active plan — choose which plan to save into" }`.
  - no active plan → `400 { error: "No active savings plan" }` (unchanged).

## What the UI needs to do
On the Record Saving screen (single and bulk):
1. Fetch the customer's **active** plans (the customers/plan list already carries
   them; show goal + daily amount + start date so they're distinguishable).
2. If there is **one** active plan, keep today's flow (no picker needed) — you may
   still send its `planId`.
3. If there is **more than one**, show a **plan picker** and send the chosen
   **`planId`** in the body of `POST /api/transactions/saving` (and `/bulk`).
4. Handle the new `400 "…choose which plan…"` gracefully (shouldn't happen once
   the picker is in, but surface it rather than failing silently).

## Also newly available (optional, from the same batch)
- Customers can set a **future start date** on a plan: `POST /api/customer/plan`
  and `POST /api/customer/enroll` accept an optional `startDate` ("yyyy-mm-dd",
  today or later). The customer plan screens that say "Your plan starts today"
  can offer a date picker.
- Enrol photos are now sanity-checked server-side (png/jpeg/webp data URL, ≤ 5 MB).
  No UI change needed — valid camera photos pass; this only blocks direct-API abuse.
