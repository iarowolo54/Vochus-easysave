// The webhook body is signed, but money is only credited after Paystack itself confirms the charge: it must
// be successful, in naira, and for the amount the webhook claimed. A test-mode key moves no real money, so
// (like the auto-debit path) it trusts the signed body, except for 'addenroll-' refs whose test hook supplies
// the card authorization.
import { isTestMode, verifyTransaction, type PaystackAuthorization } from '@/lib/paystack'
import { money } from '@/lib/wallet-guard'

export type Reverified =
  | { kind: 'ok'; amountNaira: number; currency: string; authorization?: PaystackAuthorization }
  | { kind: 'not-successful'; status: string }
  | { kind: 'mismatch'; reason: string }

/** Throws when Paystack can't be reached, so the caller can answer 5xx and Paystack redelivers the webhook. */
export async function reverifyCharge(
  reference: string,
  claimed: { amountNaira: number; currency?: string },
): Promise<Reverified> {
  const claimedAmount = money(claimed.amountNaira)
  const claimedCurrency = claimed.currency || 'NGN'

  if (isTestMode()) {
    if (!reference.startsWith('addenroll-')) return { kind: 'ok', amountNaira: claimedAmount, currency: claimedCurrency }
    const hooked = await verifyTransaction(reference)
    return { kind: 'ok', amountNaira: claimedAmount, currency: claimedCurrency, authorization: hooked.authorization }
  }

  const verified = await verifyTransaction(reference)
  if (verified.status !== 'success') return { kind: 'not-successful', status: verified.status }
  if (verified.currency !== claimedCurrency) {
    return { kind: 'mismatch', reason: `Paystack says ${verified.currency}, the webhook said ${claimedCurrency}` }
  }
  if (money(verified.amountNaira) !== claimedAmount) {
    return { kind: 'mismatch', reason: `Paystack says ₦${verified.amountNaira}, the webhook said ₦${claimedAmount}` }
  }
  return { kind: 'ok', amountNaira: money(verified.amountNaira), currency: verified.currency, authorization: verified.authorization }
}
