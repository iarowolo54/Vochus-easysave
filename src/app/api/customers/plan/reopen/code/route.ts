import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { limitByIp } from '@/lib/password-reset'
import { checkReopenable, REOPEN_COLLECTING, REOPEN_NOT_FINISHED, REOPEN_NOT_FOUND, REOPEN_REDEEMED } from '@/lib/plan-reopen'
import { requestReopenCode, REOPEN_CODE_NOT_SENT, REOPEN_CODE_WAIT } from '@/lib/plan-reopen-code'

// Texts the customer a code. The agent types it in after the customer reads it out, which proves they agreed.
export async function POST(req: NextRequest) {
  const limited = limitByIp(req, 'request')
  if (limited) return limited
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent = await prisma.agent.findFirst({ where: { agentId: session.user.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body: unknown = await req.json().catch(() => null)
  const { customerId, planId } = (body && typeof body === 'object' ? body : {}) as { customerId?: unknown; planId?: unknown }
  if (typeof customerId !== 'string' || typeof planId !== 'string' || !customerId || !planId) {
    return NextResponse.json({ error: 'Missing customer or plan' }, { status: 400 })
  }

  const customer = await prisma.customer.findFirst({ where: { id: customerId, agentId: agent.id }, select: { id: true, phone: true, firstName: true, email: true, emailVerifiedAt: true } })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const check = await checkReopenable(prisma, { planId, customerId: customer.id })
  if (!check.ok) {
    if (check.reason === 'not_found') return NextResponse.json({ error: REOPEN_NOT_FOUND }, { status: 404 })
    if (check.reason === 'redeemed') return NextResponse.json({ error: REOPEN_REDEEMED }, { status: 409 })
    if (check.reason === 'collecting') return NextResponse.json({ error: REOPEN_COLLECTING }, { status: 409 })
    return NextResponse.json({ error: REOPEN_NOT_FINISHED }, { status: 409 })
  }

  const sent = await requestReopenCode(customer, planId, true)
  if (!sent.ok) return NextResponse.json({ error: sent.reason === 'wait' ? REOPEN_CODE_WAIT : REOPEN_CODE_NOT_SENT }, { status: sent.reason === 'wait' ? 429 : 502 })
  return NextResponse.json({ resetId: sent.resetId, sentTo: sent.sentTo, sentBy: sent.sentBy })
}
