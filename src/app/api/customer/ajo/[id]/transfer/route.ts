import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { requireEnv } from '@/lib/env'
import { openRound } from '@/lib/ajo'
import { createTransferIntent } from '@/lib/transfer-intent'
import { getFundingMode, TRANSFER_NOT_IN_USE } from '@/lib/funding-mode'
import { AJO_PAY_LIMIT, ajoCodeRateLimiter } from '@/lib/rate-limit'

/** Start paying the open round by bank transfer. The amount is the group's contribution plus our kobo marker. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await getFundingMode(prisma)).customer === 'card') return NextResponse.json({ error: TRANSFER_NOT_IN_USE }, { status: 410 })
  // Each start reserves a unique kobo amount for a while, so one person can't use them all up.
  if (!ajoCodeRateLimiter.check(`ajo-pay:${session.id}`, AJO_PAY_LIMIT.perCustomer, AJO_PAY_LIMIT.windowMs).allowed) {
    return NextResponse.json({ error: 'Too many tries. Wait a few minutes, then try again.' }, { status: 429 })
  }
  const { id } = await params
  const member = await prisma.ajoMember.findFirst({
    where: { groupId: id, customerId: session.id },
    select: { id: true, group: { select: { id: true, name: true, status: true, size: true, contribution: true, payouts: { select: { round: true } } } } },
  })
  if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const g = member.group
  if (g.status !== 'Running') return NextResponse.json({ error: g.status === 'Forming' ? 'This group hasn’t started yet.' : 'This group has finished.' }, { status: 409 })
  const round = openRound(g.size, g.payouts.map(p => p.round))
  if (round === null) return NextResponse.json({ error: 'This group has finished.' }, { status: 409 })
  if (await prisma.ajoContribution.count({ where: { memberId: member.id, round } })) {
    return NextResponse.json({ error: 'You’ve already paid this round. You can pay the next one once everyone has paid this one.' }, { status: 409 })
  }

  const intent = await createTransferIntent({ actor: { customerId: session.id }, planId: null, baseAmount: g.contribution, ajo: { memberId: member.id, round } })
  if (!intent) return NextResponse.json({ error: 'Lots of people are paying right now. Please try again in a few minutes.' }, { status: 503 })
  logAudit({ action: 'transfer_initiated', entity: 'PaymentIntent', details: `Ajo group "${g.name}" round ${round}: bank transfer of ₦${intent.payAmount.toFixed(2)} started — ref ${intent.ref}`, actorType: 'customer', actorId: session.id })
  return NextResponse.json({
    ref: intent.ref, payAmount: intent.payAmount, expiresAt: intent.expiresAt.toISOString(), round,
    account: { bank: 'Moniepoint', number: requireEnv('MONIEPOINT_ACCOUNT_NUMBER'), name: requireEnv('MONIEPOINT_ACCOUNT_NAME') },
  })
}
