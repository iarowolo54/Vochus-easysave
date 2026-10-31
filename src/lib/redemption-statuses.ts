// Client-safe status registries (no server imports) shared by routes and pages.

/** Redemption statuses that mean a payout is in progress or done: the plan must not be redeemed again.
 *  `Finalizing` = OTP finalize claimed/possibly accepted by Paystack; it MUST stay here or a stuck
 *  record re-opens a double-pay window. */
export const IN_FLIGHT_REDEMPTION_STATUSES = ['Pending', 'TokenValidated', 'AgentApproved', 'AwaitingOTP', 'Finalizing', 'Approved']

/** Agent-withdrawal statuses that are still in progress (no new request allowed, shown as pending). */
export const IN_FLIGHT_WITHDRAWAL_STATUSES = ['Pending', 'AwaitingOTP', 'Processing', 'Finalizing']
