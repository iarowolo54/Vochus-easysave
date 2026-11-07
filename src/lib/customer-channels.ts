// How a customer's messages reach them. SMS costs money, so it is used only where the owner's rule allows it
// (see tests/sms-sites.test.ts): online customers are reached by email, cash customers by SMS.

export type MessageChannel = 'email' | 'sms'

type Contact = { online: boolean; email?: string | null; emailVerifiedAt?: Date | null }

/** A usable email for a code: confirmed by the customer. An unconfirmed one may be whatever an agent typed. */
function confirmedEmail(c: Contact): boolean {
  return !!c.email?.trim() && !!c.emailVerifiedAt
}

/**
 * Where a collection code goes. Online customers with a confirmed email: email only. Everyone else: SMS, and a cash
 * customer's confirmed email as well (they collect through their agent and may not check email).
 */
export function collectionCodeChannels(c: Contact): MessageChannel[] {
  if (c.online) return confirmedEmail(c) ? ['email'] : ['sms']
  return confirmedEmail(c) ? ['sms', 'email'] : ['sms']
}
