import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { asCustomerType, planReopenBlock } from '@/lib/customer-type'
import { limitByIp } from '@/lib/password-reset'
import { checkReopenable, REOPEN_COLLECTING, REOPEN_NOT_FINISHED, REOPEN_NOT_FOUND, REOPEN_REDEEMED } from '@/lib/plan-reopen'
import { requestReopenCode, REOPEN_CODE_NOT_SENT, REOPEN_CODE_WAIT } from '@/lib/plan-reopen-code'

// Sends the customer a code by SMS to confirm they want to save into this finished plan again.
export async function POST(req: NextRequest) {
  const limited = limitByIp(req, 'request')
  if (limited) return limited
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Offline (agent-registered) customers have their plans restarted by their agent.
  const reopenBlocked = planReopenBlock(asCustomerType((await prisma.customer.findUnique({ where: { id: session.id }, select: { type: true } }))?.type))
  if (reopenBlocked) return NextResponse.json({ error: reopenBlocked }, { status: 403 })

  const body: unknown = await req.json().catch(() => null)
  const planId = body && typeof body === 'object' ? (body as { planId?: unknown }).planId : undefined
  if (typeof planId !== 'string' || !planId) return NextResponse.json({ error: 'Missing plan' }, { status: 400 })

  const check = await checkReopenable(prisma, { planId, customerId: session.id })
  if (!check.ok) {
    if (check.reason === 'not_found') return NextResponse.json({ error: REOPEN_NOT_FOUND }, { status: 404 })
    if (check.reason === 'redeemed') return NextResponse.json({ error: REOPEN_REDEEMED }, { status: 409 })
    if (check.reason === 'collecting') return NextResponse.json({ error: REOPEN_COLLECTING }, { status: 409 })
    return NextResponse.json({ error: REOPEN_NOT_FINISHED }, { status: 409 })
  }

  const customer = await prisma.customer.findUnique({ where: { id: session.id }, select: { id: true, phone: true, firstName: true, email: true, emailVerifiedAt: true } })
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sent = await requestReopenCode(customer, planId, false)
  if (!sent.ok) return NextResponse.json({ error: sent.reason === 'wait' ? REOPEN_CODE_WAIT : REOPEN_CODE_NOT_SENT }, { status: sent.reason === 'wait' ? 429 : 502 })
  return NextResponse.json({ resetId: sent.resetId, sentTo: sent.sentTo, sentBy: sent.sentBy })
}
