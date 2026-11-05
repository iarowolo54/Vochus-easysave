// Reads Moniepoint credit alerts from the connected Gmail (IMAP, read-only) and settles the transfer each one pays for.
// Credits only on one exact match; anything else is recorded for staff and never credited on a guess.
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { prisma } from '@/lib/prisma'
import { requireEnv } from '@/lib/env'
import { REVIEW_ACTION } from '@/lib/payment-intent'
import { settleIntentPayment } from '@/lib/customer-settle'
import { settleAgentTransfer } from '@/lib/agent-settle'
import { isAuthenticAlert, parseMoniepointAlert, type ParsedAlert } from '@/lib/moniepoint-alert'
import { TRANSFER_METHOD, matchAlertToIntent, openTransferIntents } from '@/lib/transfer-intent'

export interface PollResult { scanned: number; credited: number; unmatched: number }

const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000
const MIN_GAP_MS = 10_000
const SYSTEM_ACTOR = { actorType: 'system', actorName: 'Moniepoint transfer' }

/** One alert, already verified and parsed. Returns what became of it. */
async function processAlert(alert: ParsedAlert, messageId: string): Promise<'credited' | 'unmatched' | 'skipped'> {
  // Paystack paying its own settlements into this account is not a customer deposit.
  if (/^paystack$/i.test(alert.senderName.trim())) return 'skipped'

  const known = await prisma.bankAlert.findFirst({ where: { OR: [{ messageId }, { txnId: alert.txnId }] }, select: { id: true } })
  if (known) return 'skipped'

  // Before transfers were switched on, credits to this account are none of our business.
  const first = await prisma.paymentIntent.findFirst({ where: { method: TRANSFER_METHOD }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })
  if (!first || alert.at < first.createdAt) return 'skipped'

  const match = matchAlertToIntent(alert, await openTransferIntents())
  const base = { messageId, txnId: alert.txnId, amount: alert.amount, senderName: alert.senderName, narration: alert.narration, alertAt: alert.at }

  if (match === 'none' || match === 'ambiguous') {
    const row = await prisma.bankAlert.create({ data: { ...base, status: 'Unmatched' } })
    await prisma.auditLog.create({
      data: {
        action: REVIEW_ACTION, entity: 'BankAlert', entityId: row.id,
        details: `Not credited, needs manual review: ₦${alert.amount} from ${alert.senderName || 'unknown'} matched ${match === 'none' ? 'no open transfer' : 'more than one open transfer'} — bank txn ${alert.txnId}`,
        ...SYSTEM_ACTOR,
      },
    })
    return 'unmatched'
  }

  // Written first: its unique keys stop a second poll crediting the same alert while this one settles.
  const row = await prisma.bankAlert.create({ data: { ...base, status: 'Matched', intentRef: match.ref } })
  try {
    const intent = await prisma.paymentIntent.findUnique({ where: { ref: match.ref } })
    if (!intent) throw new Error('intent vanished')
    const result = intent.actorType === 'agent'
      ? await settleAgentTransfer(prisma, { intent, reference: match.ref, amountNaira: alert.amount, via: 'Moniepoint transfer' })
      : await settleIntentPayment(prisma, {
          intent, reference: match.ref, amountNaira: alert.amount, currency: 'NGN', channel: 'bank_transfer', via: 'Moniepoint transfer',
        })
    if (result.kind === 'review') {
      await prisma.bankAlert.update({ where: { id: row.id }, data: { status: 'Unmatched' } })
      return 'unmatched'
    }
    return result.kind === 'credited' ? 'credited' : 'skipped'
  } catch (e) {
    // Nothing was credited, so take the claim back and let the next poll try again.
    await prisma.bankAlert.delete({ where: { id: row.id } }).catch(() => {})
    throw e
  }
}

export async function pollMoniepointAlerts(): Promise<PollResult> {
  const sender = requireEnv('MONIEPOINT_SENDER')
  const ourAccount = requireEnv('MONIEPOINT_ACCOUNT_NUMBER')
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: requireEnv('IMAP_USER'), pass: requireEnv('IMAP_APP_PASSWORD') },
  })
  const out: PollResult = { scanned: 0, credited: 0, unmatched: 0 }

  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true })
    try {
      const uids = await client.search({ from: sender, since: new Date(Date.now() - LOOKBACK_MS) }, { uid: true })
      if (!uids || uids.length === 0) return out
      for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
        if (!msg.source) continue
        out.scanned++
        const mail = await simpleParser(msg.source)
        const authResults = mail.headerLines
          .filter((h) => h.key === 'authentication-results')
          .map((h) => h.line.slice(h.line.indexOf(':') + 1))
        if (!isAuthenticAlert((mail.from?.value ?? []).map((a) => a.address ?? ''), authResults, sender)) continue
        const alert = parseMoniepointAlert(mail.text || (typeof mail.html === 'string' ? mail.html : ''))
        if (!alert) {
          // A real credit alert in a layout we can't read would otherwise be dropped without a trace.
          if (/credit/i.test(mail.subject ?? '')) console.warn(`[bank-alerts] credit-looking email could not be read, messageId=${mail.messageId ?? 'none'}`)
          continue
        }
        // A genuine Moniepoint alert for someone else's account (replayed to this inbox) must never credit ours.
        if (alert.accountNumber !== ourAccount) continue
        const outcome = await processAlert(alert, mail.messageId ?? `txn-${alert.txnId}`)
        if (outcome === 'credited') out.credited++
        else if (outcome === 'unmatched') out.unmatched++
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
  return out
}

let running: Promise<PollResult> | null = null
let lastStart = 0

/** For customer status checks: reuses a run in progress and skips one that just finished, so a busy screen can't hammer Gmail. */
export async function pollIfStale(): Promise<void> {
  if (running) { await running.catch(() => {}); return }
  if (Date.now() - lastStart < MIN_GAP_MS) return
  lastStart = Date.now()
  running = pollMoniepointAlerts().finally(() => { running = null })
  await running.catch(() => {})
}
