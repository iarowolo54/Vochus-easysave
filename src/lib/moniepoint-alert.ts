// Reading a Moniepoint "Credit alert!" email. Pure: no mail or database access here.
import { createHash } from 'node:crypto'

export interface ParsedAlert {
  amount: number
  /** The account the money landed in. A genuine alert for another account must never credit ours. */
  accountNumber: string
  senderName: string
  narration: string
  /** Dedupe key: a hash of the whole alert. The balance after the credit differs every time, and the sender-typed narration can't force a clash. */
  txnId: string
  at: Date
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function toText(raw: string): string {
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
}

/** "02 Nov, 2026 | 07:52:45 PM" in Lagos time (UTC+1, no daylight saving) to a real instant. */
function parseLagosTime(s: string): Date | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})\s*\|?\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i.exec(s)
  if (!m) return null
  const month = MONTHS.indexOf(m[2].toLowerCase())
  if (month < 0) return null
  let hour = Number(m[4]) % 12
  if (m[7].toUpperCase() === 'PM') hour += 12
  const ms = Date.UTC(Number(m[3]), month, Number(m[1]), hour - 1, Number(m[5]), Number(m[6]))
  return Number.isFinite(ms) ? new Date(ms) : null
}

/** The first alert in the text, or null if it isn't a credit alert. A body repeated in the same email is read once. */
export function parseMoniepointAlert(raw: string): ParsedAlert | null {
  const t = toText(raw)
  const amt = /Credit Amount\s*(?:N|₦|NGN)?\s*([\d,]+(?:\.\d{1,2})?)/i.exec(t)
  const when = /Date\s*&\s*Time:\s*(.+?)(?:Narration:|$)/i.exec(t)
  const narr = /Narration:\s*(.+?)(?:-{3,}|If you experience|$)/i.exec(t)
  if (!amt || !when || !narr) return null

  const amount = Number(amt[1].replace(/,/g, ''))
  const at = parseLagosTime(when[1])
  const narration = narr[1].trim()
  const account = /Account Number:\s*(\d{10})/i.exec(t)
  if (!(amount > 0) || !at || !account) return null

  const sender = /Sender's Name:\s*(?:from\s+)?(.+?)(?:-{3,}|Date\s*&|$)/i.exec(t)
  const senderName = sender ? sender[1].trim() : ''
  const balance = /Account Balance:\s*(?:N|₦|NGN)?\s*([\d,]+(?:\.\d{1,2})?)/i.exec(t)
  const txnId = 'h' + createHash('sha256')
    .update([amount, at.toISOString(), account[1], senderName, narration, balance ? balance[1] : ''].join('|'))
    .digest('hex').slice(0, 24)
  return { amount, accountNumber: account[1], senderName, narration, txnId, at }
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1).toLowerCase()
}

/** The receiving server whose Authentication-Results we trust. Any other header of that name came with the message. */
const TRUSTED_AUTHSERV = 'mx.google.com'

/**
 * True only for mail genuinely from the expected sender: exactly one From address, equal to it, and the TOPMOST
 * Authentication-Results header (the one Gmail added on receipt) says dkim=pass signed by that sender's own domain and
 * dmarc=pass. `fromAddresses` are the parsed addresses, never display text. `authResults` are in header order, top first.
 */
export function isAuthenticAlert(fromAddresses: string[], authResults: string[], expectedSender: string): boolean {
  const expected = expectedSender.trim().toLowerCase()
  if (!expected || fromAddresses.length !== 1 || fromAddresses[0].trim().toLowerCase() !== expected) return false

  const top = authResults[0]?.toLowerCase().trim()
  if (!top || !top.startsWith(`${TRUSTED_AUTHSERV};`)) return false

  const domain = domainOf(expected).replace(/\./g, '\\.')
  const dkimOk = new RegExp(`dkim=pass[^;]*header\\.[id]=@?(?:[a-z0-9.-]+\\.)?${domain}(?![a-z0-9.-])`).test(top)
  const dmarcOk = new RegExp(`dmarc=pass[^;]*header\\.from=${domain}(?![a-z0-9.-])`).test(top)
  return dkimOk && dmarcOk
}
