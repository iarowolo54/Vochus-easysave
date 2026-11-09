import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, adminActor } from '@/lib/admin-guard'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { prisma } from '@/lib/prisma'
import { parseAjoFee } from '@/lib/ajo'
import { AJO_FEE_SETTING_KEY, getAjoFee } from '@/lib/ajo-fee'

export async function GET() {
  const guard = await requirePermission('ajo', 'view')
  if (!guard.ok) return guard.response
  return NextResponse.json({ fee: await getAjoFee(prisma) }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Set the Platform Fee. It applies to groups that start from now on; a running group keeps the rate it started with. */
export async function POST(req: NextRequest) {
  const guard = await requirePermission('ajo', 'manage')
  if (!guard.ok) return guard.response
  const body: unknown = await req.json().catch(() => null)
  const parsed = parseAjoFee(body)
  if (!parsed.ok) return NextResponse.json({ error: 'Check the highlighted fields.', errors: parsed.errors }, { status: 400 })
  const pin = body && typeof body === 'object' ? (body as { pin?: unknown }).pin : undefined
  if (!pin) return NextResponse.json({ error: 'Approval PIN required' }, { status: 400 })
  const pinCheck = await verifyApprovalPin(guard.session, pin)
  if (!pinCheck.ok) return pinCheck.response

  const value = JSON.stringify(parsed.value)
  const before = await getAjoFee(prisma)
  await prisma.$transaction([
    prisma.platformSetting.upsert({ where: { key: AJO_FEE_SETTING_KEY }, create: { key: AJO_FEE_SETTING_KEY, value }, update: { value } }),
    prisma.auditLog.create({ data: {
      action: 'ajo_platform_fee_changed', entity: 'PlatformSetting', entityId: AJO_FEE_SETTING_KEY, actorType: 'admin', ...adminActor(guard.session),
      details: `Ajo Platform Fee changed from ${before.feePct}% (agent ${before.agentSharePct}%) to ${parsed.value.feePct}% (agent ${parsed.value.agentSharePct}%)`,
    } }),
  ])
  return NextResponse.json({ fee: parsed.value })
}
