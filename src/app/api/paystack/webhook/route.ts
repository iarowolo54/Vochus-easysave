import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

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

  return NextResponse.json({ ok: true })
}
