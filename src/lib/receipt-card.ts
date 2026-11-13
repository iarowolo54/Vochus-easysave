// The receipt a chat message carries when an agent taps "Send to customer". The server builds it from its own records
// (buildReceiptCard in receipt-message.ts) and stores it as JSON on CustomerChatMessage.receipt; both chats draw it as
// the receipt picture with the same code as "Save receipt image". Safe to import in the browser.

export type ReceiptCard = {
  title: string
  /** Already formatted, or "—" when a receipt has no amount (enrolment). */
  amount: string
  status: string
  rows: [string, string][]
  reference: string
}

const MAX_ROWS = 8
const MAX_TEXT = 200

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT

/** A stored receipt, or null when there is none or it isn't one this screen can draw. Never throws. */
export function parseReceiptCard(raw: unknown): ReceiptCard | null {
  if (typeof raw !== 'string' || !raw) return null
  let v: unknown
  try { v = JSON.parse(raw) } catch { return null }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (!isText(o.title) || !isText(o.amount) || !isText(o.status) || !isText(o.reference)) return null
  if (!Array.isArray(o.rows) || o.rows.length > MAX_ROWS) return null
  const rows: [string, string][] = []
  for (const r of o.rows) {
    if (!Array.isArray(r) || r.length !== 2 || !isText(r[0]) || !isText(r[1])) return null
    rows.push([r[0], r[1]])
  }
  return { title: o.title, amount: o.amount, status: o.status, rows, reference: o.reference }
}
