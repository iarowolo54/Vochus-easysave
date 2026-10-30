// NOTE: there are TWO webhook handlers in this repo (api/paystack/webhook and api/webhooks/paystack); confirm which one Paystack is configured to POST before relying on this in prod.
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { verifyTransaction } from '@/lib/paystack'
import { creditAutoDebitAttempt } from '@/lib/auto-debit-credit'

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('x-paystack-signature') ?? ''
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET
  // Fail closed: never verify against an empty secret (an empty HMAC key is forgeable).
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })

  const expected = crypto.createHmac('sha512', secret).update(body).digest('hex')
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(body)
  const { event: type, data } = event

  logAudit({
    action: 'paystack_webhook_received',
    entity: 'EarlyRedemption',
    details: `Paystack webhook received — event: ${type}, transfer_code: ${data?.transfer_code ?? 'N/A'}, amount: ₦${data?.amount ? (data.amount / 100).toLocaleString() : 'N/A'}`,
    actorType: 'system',
    actorName: 'Paystack Webhook',
  })

  if (['transfer.success', 'transfer.failed', 'transfer.reversed'].includes(type)) {
    const transferCode = data.transfer_code as string
    const statusMap: Record<string, string> = {
      'transfer.success': 'success',
      'transfer.failed': 'failed',
      'transfer.reversed': 'reversed',
    }
    await prisma.earlyRedemption.updateMany({
      where: { paystackTransferCode: transferCode },
      data: { bankTransferStatus: statusMap[type] },
    })
    logAudit({
      action: 'paystack_transfer_status_update',
      entity: 'EarlyRedemption',
      details: `Paystack webhook: transfer ${transferCode} → ${statusMap[type]}`,
      actorType: 'system',
      actorName: 'Paystack Webhook',
    })
  }

  // Scheduled auto-debit charges only ('autodebit-'); 'addenroll-' enrollment refs are handled elsewhere.
  if (type === 'charge.success' && typeof data?.reference === 'string' && data.reference.startsWith('autodebit-')) {
    try {
      const reference = data.reference as string
      // Never trust the webhook body for crediting: re-verify with Paystack.
      const verified = await verifyTransaction(reference)
      if (verified.status === 'success') {
        const attempt = await prisma.autoDebitAttempt.findUnique({ where: { reference } })
        if (attempt) {
          // Test mode verifies with amount 0, so only enforce amount/currency when a real amount came back.
          const hasAmount = verified.amountNaira > 0
          const ok = !hasAmount || (verified.currency === 'NGN' && verified.amountNaira >= attempt.creditAmount)
          if (ok) {
            await creditAutoDebitAttempt(prisma, {
              reference,
              settledAmountNaira: hasAmount ? verified.amountNaira : attempt.grossCharged,
            })
          }
        }
      }
    } catch (e: unknown) {
      // Swallow so Paystack gets a 200; the reconciliation sweep recovers anything missed.
      console.error('auto-debit webhook credit failed:', e instanceof Error ? e.message : 'unknown error')
    }
  }

  return NextResponse.json({ ok: true })
}
