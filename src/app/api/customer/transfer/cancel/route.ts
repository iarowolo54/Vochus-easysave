import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { logAudit } from '@/lib/audit'
import { cancelTransferIntent } from '@/lib/transfer-intent'

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: unknown = await req.json().catch(() => null)
  const ref = body && typeof body === 'object' ? (body as { ref?: unknown }).ref : null
  if (typeof ref !== 'string' || !ref) return NextResponse.json({ error: 'Missing reference' }, { status: 400 })

  const cancelled = await cancelTransferIntent(ref, { customerId: session.id })
  if (cancelled) {
    logAudit({
      action: 'transfer_cancelled', entity: 'PaymentIntent', details: `Customer cancelled bank transfer request ${ref}`,
      actorType: 'customer', actorId: session.id,
    })
  }
  // false means it was already paid, closed or isn't theirs: the screen looks again instead of saying it was cancelled.
  return NextResponse.json({ cancelled })
}
