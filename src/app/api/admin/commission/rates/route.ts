import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

const SETTING_KEY = 'commissionRates'
const DEFAULTS = { agentSavings: 0.4, agentLoan: 1.0, agentRepay: 0.5, platformSavings: 1.6, platformLoan: 5.0, platformPenalty: 2.0 }

export async function GET() {
  const guard = await requirePermission('agents')
  if (!guard.ok) return guard.response
  const session = guard.session

  const setting = await prisma.platformSetting.findUnique({ where: { key: SETTING_KEY } })
  const rates = setting ? JSON.parse(setting.value) : DEFAULTS
  return NextResponse.json({ rates })
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('agents')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { rates } = await req.json()
  if (!rates || typeof rates !== 'object') return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const keys = ['agentSavings', 'agentLoan', 'agentRepay', 'platformSavings', 'platformLoan', 'platformPenalty']
  for (const k of keys) {
    const v = rates[k]
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 100) {
      return NextResponse.json({ error: `Invalid value for ${k}` }, { status: 400 })
    }
  }

  await prisma.platformSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(rates) },
    create: { key: SETTING_KEY, value: JSON.stringify(rates) },
  })

  const adminUser = session.user as any
  logAudit({
    action: 'commission_rates_updated',
    entity: 'PlatformSetting',
    details: `Commission rates updated: agent savings ${rates.agentSavings}%, agent loan ${rates.agentLoan}%, platform savings ${rates.platformSavings}%, platform loan ${rates.platformLoan}%`,
    actorType: 'admin',
    actorId: adminUser.id,
    actorName: adminUser.name ?? 'Admin',
  })

  return NextResponse.json({ ok: true })
}
