// Payment-received email: once a bank transfer is credited to an agent's wallet or a customer's savings plan,
// the payer gets a receipt, the same way a bank alert works. Best effort: the credit has already happened,
// so a failed or missing email must never undo or block it.
import { sendMail } from '@/lib/mail'
import { renderEmail } from '@/lib/email-template'
import { loginTimeLabel } from '@/lib/login-alert'
import { formatNaira } from '@/lib/format'

export type PaymentAlert = {
  kind: 'saving' | 'wallet'
  email: string | null | undefined
  /** First name, for the greeting. */
  name: string
  amount: number
  reference: string
  /** How it arrived: 'Moniepoint transfer', 'Staff by hand', 'Paystack' ... */
  via: string
  /** Where the money went: the plan's goal, or the wallet. */
  destination: string
  balanceAfter: number | null
  at?: Date
}

export function paymentAlertEmail(a: PaymentAlert): { subject: string; html: string } {
  const amount = formatNaira(a.amount)
  const at = a.at ?? new Date()
  const wallet = a.kind === 'wallet'
  const subject = `Vochus received your payment of ${amount}`
  const html = renderEmail({
    subject,
    preheader: wallet ? `${amount} is now in your wallet.` : `${amount} has been added to your savings.`,
    tone: 'success',
    statusLabel: '',
    heading: `Thank you, ${a.name}`,
    banner: true,
    amountLabel: 'Vochus received your payment of',
    amount,
    rows: [
      [wallet ? 'Credited to' : 'Saved to', a.destination],
      [wallet ? 'Wallet balance' : 'Plan balance', a.balanceAfter == null ? null : formatNaira(a.balanceAfter), 'strong'],
      ['Paid by', a.via.startsWith('Paystack') ? 'Card or bank transfer' : 'Bank transfer'],
      ['Confirmed by', a.via === 'Staff by hand' ? 'Vochus staff' : null],
      ['Date', loginTimeLabel(at)],
      ['Reference', a.reference],
    ],
    note: 'Questions about this payment? Write to support@vochuseasysave.com and quote the reference above.',
  })
  return { subject, html }
}

/** Resolves either way; logs only that it failed, never the address. */
export async function sendPaymentAlert(a: PaymentAlert): Promise<void> {
  const to = a.email?.trim()
  if (!to) return
  try {
    const { subject, html } = paymentAlertEmail(a)
    await sendMail({ to, subject, html })
  } catch (e) {
    console.error('[payment-alert] send failed:', e instanceof Error ? e.message : 'unknown')
  }
}
