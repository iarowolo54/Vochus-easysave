// Who a payout goes to. An agent must not be able to send a customer's money to another account, and the
// customer should see where it is going before they hand over their code.

// Accent marks are dropped (Adébáyọ̀ is ADEBAYO on bank records), as are apostrophes (O'Neil is ONEIL).
const words = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’`]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)

// A name on a business or joint account isn't proof it belongs to this one person ("ADA OBI VENTURES", "ADA AND OBI").
const BUSINESS_WORDS = new Set(['ltd', 'limited', 'ventures', 'enterprises', 'enterprise', 'and'])
const isBusinessName = (name: string[]) => name.some(w => BUSINESS_WORDS.has(w)) || (name.includes('global') && name.includes('resources'))

/**
 * Bank names come in any order and often add a middle name ("OBI ADA CHIOMA"), so every word of the customer's
 * first and last name must appear in the account name. Ignores case, order, accents, extra names and punctuation.
 * A shortened name, a different spelling, an initial or a business name doesn't match.
 */
export function accountNameMatches(accountName: string, customer: { firstName: string; lastName: string }): boolean {
  const account = words(accountName)
  const first = words(customer.firstName)
  const last = words(customer.lastName)
  if (first.length === 0 || last.length === 0 || isBusinessName(account)) return false
  return [...first, ...last].every(w => account.includes(w))
}

export const payoutDestination = (bankName: string, accountNumber: string) => `Payout goes to ${bankName} account ending ${accountNumber.slice(-4)}.`
