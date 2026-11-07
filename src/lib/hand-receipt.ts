// Receipts for savings deposits: how the method reads on a receipt, and the one SMS a cash customer gets when staff
// approve their bank transfer by hand. Pure, so the settle path and every receipt screen say the same thing.

/** The note the settle path stores on a deposit staff credited by hand. Receipts read it back to say so. */
export const HAND_CREDIT_NOTE = 'Bank transfer credited by hand by staff'

export function isHandCredit(note: string | null | undefined): boolean {
  return note === HAND_CREDIT_NOTE
}

/** How the money moved, said plainly. A bank transfer never names the agent: they didn't handle it. */
export function methodText(tx: { method: string | null; recordedBy?: string; confirmedByStaff?: boolean }): string {
  const m = (tx.method ?? 'Cash').toLowerCase()
  if (m === 'paystack') return 'Card or bank transfer'
  if (m === 'cash') return tx.recordedBy ? `Cash, collected by ${tx.recordedBy}` : 'Cash'
  if (m === 'transfer') return tx.confirmedByStaff ? 'Bank transfer, confirmed by Vochus staff' : 'Bank transfer'
  return tx.recordedBy ? `${tx.method}, recorded by ${tx.recordedBy}` : `${tx.method}`
}

/**
 * Only a hand-approved deposit into a cash plan (opened by an agent) gets an SMS receipt. Online customers are told
 * by email and in the app; automatic transfers are told in the app. SMS costs money, so this stays narrow.
 */
export function wantsHandReceiptSms(c: { via: string; planSource: string | null | undefined }): boolean {
  return c.via === 'Staff by hand' && c.planSource !== 'self'
}

// Plain ASCII only: a naira sign turns the SMS into Unicode, which shortens each part and raises the cost.
function ngn(n: number): string {
  const whole = Number.isInteger(Math.round(n * 100) / 100)
  return `NGN ${n.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`
}

export function handReceiptSms(r: { name: string; amount: number; goal: string; balanceAfter: number | null; reference: string }): string {
  const where = r.goal.trim() || 'your savings plan'
  const balance = r.balanceAfter == null ? '' : ` Balance ${ngn(r.balanceAfter)}.`
  return `Vochus Easy Save: Hi ${r.name}, we received your bank transfer of ${ngn(r.amount)} and saved it to ${where}.${balance} Ref ${r.reference}`
}

/** Where a savings notice takes the customer: that deposit's receipt in History. */
export function receiptHref(ref: string): string {
  return `/customer/transactions?ref=${encodeURIComponent(ref)}`
}
