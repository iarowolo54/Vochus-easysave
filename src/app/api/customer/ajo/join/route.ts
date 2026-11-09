import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { AJO_CODE_NOT_FOUND, ajoCodeProblem, isJoinCode } from '@/lib/ajo'
import { AjoClosedError, AjoFullError, addMember, isUniqueViolation } from '@/lib/ajo-server'
import { AJO_CODE_LIMIT, ajoCodeRateLimiter } from '@/lib/rate-limit'

/** Join with the code. The member is the signed-in customer; the group must be their own agent's and still forming. */
export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limit = ajoCodeRateLimiter.check(`ajo:${session.id}`, AJO_CODE_LIMIT.perCustomer, AJO_CODE_LIMIT.windowMs)
  if (!limit.allowed) return NextResponse.json({ error: 'Too many tries. Wait a few minutes, then try again.' }, { status: 429 })

  const body: unknown = await req.json().catch(() => null)
  const code = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined
  if (!isJoinCode(code)) return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })
  const customer = await prisma.customer.findUnique({ where: { id: session.id }, select: { id: true, agentId: true, firstName: true, lastName: true, customerId: true, status: true } })
  if (!customer || customer.status !== 'Active') return NextResponse.json({ error: 'Your account isn’t active.' }, { status: 403 })
  const g = await prisma.ajoGroup.findUnique({ where: { code }, select: { id: true, name: true, agentId: true, status: true } })
  const problem = ajoCodeProblem(g, customer.agentId)
  if (problem || !g) return NextResponse.json({ error: problem ?? AJO_CODE_NOT_FOUND }, { status: 404 })

  try {
    await addMember(prisma, g.id, customer.id)
  } catch (e) {
    if (isUniqueViolation(e)) return NextResponse.json({ error: 'You’re already in this group.', groupId: g.id }, { status: 409 })
    if (e instanceof AjoFullError) return NextResponse.json({ error: 'This group is full.' }, { status: 409 })
    if (e instanceof AjoClosedError) return NextResponse.json({ error: 'This group has already started, so no one can join now.' }, { status: 409 })
    throw e
  }
  logAudit({ action: 'ajo_member_joined', entity: 'AjoGroup', entityId: g.id, details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) joined Ajo group "${g.name}" with its code`, actorType: 'customer', actorId: customer.id, actorName: `${customer.firstName} ${customer.lastName}` })
  return NextResponse.json({ groupId: g.id })
}
