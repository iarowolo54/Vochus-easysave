import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { FLEXIBLE_SETTING_KEY, getFlexibleSettings, validateFlexibleSettings, type FlexibleSettings } from '@/lib/flexible-savings'
import { verifyApprovalPin } from '@/lib/approval-pin'

export async function GET() {
  const guard = await requirePermission('commission', 'view')
  if (!guard.ok) return guard.response
  return NextResponse.json({ settings: await getFlexibleSettings(prisma) })
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('commission', 'manage')
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const checked = validateFlexibleSettings(body?.settings)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  const settings = checked.settings
  // These decide what is taken from customers' savings, so a saved change needs the approver's PIN, like commission rates.
  if (!body?.pin) return NextResponse.json({ error: 'Approval PIN required' }, { status: 400 })
  const pinCheck = await verifyApprovalPin(guard.session, body.pin)
  if (!pinCheck.ok) return pinCheck.response
  const before = await getFlexibleSettings(prisma)

  await prisma.platformSetting.upsert({
    where: { key: FLEXIBLE_SETTING_KEY },
    update: { value: JSON.stringify(settings) },
    create: { key: FLEXIBLE_SETTING_KEY, value: JSON.stringify(settings) },
  })

  const keys = Object.keys(settings) as (keyof FlexibleSettings)[]
  logAudit({
    action: 'flexible_savings_settings_updated',
    entity: 'PlatformSetting',
    details: `Flexible savings settings updated: ${keys.filter(k => settings[k] !== before[k]).map(k => `${k} ${before[k]} → ${settings[k]}`).join(', ') || 'no change'}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true, settings })
}
