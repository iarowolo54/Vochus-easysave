import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  try {
    const guard = await requirePermission('money')
    if (!guard.ok) return guard.response
    const session = guard.session

    const body = await req.json()
    const amount = parseFloat(body.amount)
    if (!amount || amount <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })

    const capital = await prisma.platformWallet.findUnique({ where: { type: 'Capital' } })
    if (!capital || capital.balance < amount) {
      return NextResponse.json({ error: 'Insufficient Capital wallet balance' }, { status: 400 })
    }

    await prisma.$transaction([
      prisma.platformWallet.update({ where: { type: 'Capital' }, data: { balance: { decrement: amount } } }),
      prisma.platformWallet.update({ where: { type: 'Float' }, data: { balance: { increment: amount } } }),
    ])

    logAudit({
      action: 'capital_to_float',
      entity: 'Wallet',
      details: `Moved ₦${amount} from Capital to Float wallet`,
      actorType: 'admin',
      ...adminActor(session),
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[capital-to-float]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
