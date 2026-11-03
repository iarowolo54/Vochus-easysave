import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { getCommissionRates, SETTING_KEY, validateRates } from '@/lib/commission-rates'

export async function GET() {
  const guard = await requirePermission('commission', 'view')
  if (!guard.ok) return guard.response
  const session = guard.session

  return NextResponse.json({ rates: await getCommissionRates(prisma) })
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('commission', 'manage')
  if (!guard.ok) return guard.response
  const session = guard.session

  const body = await req.json().catch(() => null)
  const checked = validateRates(body?.rates)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  const rates = checked.rates

  await prisma.platformSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(rates) },
    create: { key: SETTING_KEY, value: JSON.stringify(rates) },
  })

  logAudit({
    action: 'commission_rates_updated',
    entity: 'PlatformSetting',
    details: `Commission rates updated: agent savings ${rates.agentSavings}%, agent loan ${rates.agentLoan}%, platform savings ${rates.platformSavings}%, platform loan ${rates.platformLoan}%`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true })
}
