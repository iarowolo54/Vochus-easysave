import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, adminActor } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { isValidAmount, MAX_ADMIN_FUND, money } from '@/lib/wallet-guard'

export async function POST(req: NextRequest) {
  try {
    const guard = await requireSuperAdmin()
    if (!guard.ok) return guard.response
    const session = guard.session

    const body: unknown = await req.json().catch(() => null)
    const { amount, reference } = (body && typeof body === 'object' ? body : {}) as { amount?: unknown; reference?: unknown }
    if (!isValidAmount(amount, MAX_ADMIN_FUND)) {
      return NextResponse.json({ error: `Amount must be between 0.01 and ${MAX_ADMIN_FUND}` }, { status: 400 })
    }
    const value = money(amount)
    const ref = typeof reference === 'string' ? reference.trim().slice(0, 100) : ''

    const wallet = await prisma.platformWallet.upsert({
      where: { type: 'Capital' },
      update: { balance: { increment: value } },
      create: { type: 'Capital', balance: value },
    })

    await logAudit({
      action: 'capital_inject',
      entity: 'Wallet',
      entityId: wallet.id,
      details: `Capital wallet injected with ₦${value} (new balance ₦${money(wallet.balance)}), reference: ${ref || '(no reference)'}`,
      actorType: 'admin',
      ...adminActor(session),
    })

    return NextResponse.json({ wallet })
  } catch (err) {
    console.error('[inject-capital]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
