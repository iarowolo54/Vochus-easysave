import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { reportKoboLeftOut } from '@/lib/transfer-report'

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: unknown = await req.json().catch(() => null)
  const ref = body && typeof body === 'object' ? (body as { ref?: unknown }).ref : null
  if (typeof ref !== 'string' || !ref) return NextResponse.json({ error: 'Missing reference' }, { status: 400 })

  const reported = await reportKoboLeftOut(ref, { customerId: session.id }, { type: 'customer', id: session.id })
  return NextResponse.json({ reported })
}
