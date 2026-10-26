import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(adminAuthOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const amount = parseFloat(body.amount)
    if (!amount || amount <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })

    const wallet = await prisma.platformWallet.upsert({
      where: { type: 'Capital' },
      update: { balance: { increment: amount } },
      create: { type: 'Capital', balance: amount },
    })

    logAudit({
      action: 'capital_inject',
      entity: 'Wallet',
      entityId: wallet.id,
      details: `Capital wallet injected with ₦${amount} (new balance ₦${wallet.balance})`,
      actorType: 'admin',
      actorName: 'SuperAdmin',
    })

    return NextResponse.json({ wallet })
  } catch (err) {
    console.error('[inject-capital]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
