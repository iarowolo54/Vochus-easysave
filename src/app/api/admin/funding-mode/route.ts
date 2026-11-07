import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { PAYSTACK_ENABLED } from '@/lib/paystack-off'
import { FUNDING_SETTING_KEY, getSavedFundingMode, validateFundingMode } from '@/lib/funding-mode'

/** How agents top up and how customers save online: { mode, paystackEnabled }. */
export async function GET() {
  const guard = await requirePermission('payout-mode', 'view')
  if (!guard.ok) return guard.response
  return NextResponse.json({ mode: await getSavedFundingMode(prisma), paystackEnabled: PAYSTACK_ENABLED })
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('payout-mode', 'manage')
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null) as { mode?: unknown; pin?: unknown } | null
  const checked = validateFundingMode(body?.mode, PAYSTACK_ENABLED)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  // Decides where real money comes in, so a change needs the approver's PIN.
  if (!body?.pin) return NextResponse.json({ error: 'Approval PIN required' }, { status: 400 })
  const pinCheck = await verifyApprovalPin(guard.session, body.pin)
  if (!pinCheck.ok) return pinCheck.response

  const before = await getSavedFundingMode(prisma)
  const value = checked.mode
  await prisma.platformSetting.upsert({
    where: { key: FUNDING_SETTING_KEY },
    update: { value: JSON.stringify(value) },
    create: { key: FUNDING_SETTING_KEY, value: JSON.stringify(value) },
  })
  logAudit({
    action: 'funding_mode_updated',
    entity: 'PlatformSetting',
    details: `Top-up method: agents ${before.agent}→${value.agent}, customers ${before.customer}→${value.customer}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })
  return NextResponse.json({ ok: true, mode: value })
}
