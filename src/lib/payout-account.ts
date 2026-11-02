// Who a payout goes to. An agent must not be able to send a customer's money to another account, and the
// customer should see where it is going before they hand over their code.

const words = (s: string) => s.toLowerCase().replace(/['’`]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * Bank names come in any order and often add a middle name ("OBI ADA CHIOMA"), so every word of the customer's
 * first and last name must appear in the account name. Ignores case, order, extra names and punctuation.
 * A shortened name, a different spelling or an initial doesn't match.
 */
export function accountNameMatches(accountName: string, customer: { firstName: string; lastName: string }): boolean {
  const account = new Set(words(accountName))
  const needed = [...words(customer.firstName), ...words(customer.lastName)]
  return needed.length > 0 && needed.every(w => account.has(w))
}

export const payoutDestination = (bankName: string, accountNumber: string) => `Payout goes to ${bankName} account ending ${accountNumber.slice(-4)}.`
