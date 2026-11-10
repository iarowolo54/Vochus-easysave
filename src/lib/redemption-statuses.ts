// Client-safe status registries (no server imports) shared by routes and pages.

/** Redemption statuses that mean a payout is in progress or done: the plan must not be redeemed again.
 *  `Finalizing` = OTP finalize claimed/possibly accepted by Paystack; it MUST stay here or a stuck
 *  record re-opens a double-pay window. */
export const IN_FLIGHT_REDEMPTION_STATUSES = ['Pending', 'TokenValidated', 'AgentApproved', 'AwaitingOTP', 'Finalizing', 'Approved']

/** Waiting for staff: in flight but not yet paid (incl. AwaitingOTP / Finalizing), or a transfer whose outcome needs checking. */
export const AWAITING_ACTION_REDEMPTION_STATUSES = [...IN_FLIGHT_REDEMPTION_STATUSES.filter(s => s !== 'Approved'), 'Processing']

/** The one definition of an abandoned request: its code ran out before it was confirmed. Nothing changes its
 *  stored status, which stays honest for admins, but it no longer holds the customer back. Requests an admin
 *  made have no code, so they never expire. */
export const isExpiredPending = (r: { status: string; tokenExpiry: Date | string | null }, now = new Date()) =>
  r.status === 'Pending' && r.tokenExpiry != null && new Date(r.tokenExpiry) < now

/** The same rule as a Prisma filter: spread into a where that lists statuses. */
export const excludeExpiredPending = (now = new Date()) => ({
  OR: [{ status: { not: 'Pending' } }, { tokenExpiry: null }, { tokenExpiry: { gte: now } }],
})

/** Agent-withdrawal statuses that are still in progress (no new request allowed, shown as pending). */
export const IN_FLIGHT_WITHDRAWAL_STATUSES = ['Pending', 'AwaitingOTP', 'Processing', 'Finalizing']
