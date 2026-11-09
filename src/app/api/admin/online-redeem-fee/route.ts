import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { prisma } from '@/lib/prisma'
import { ONLINE_REDEEM_FEE_KEY, getOnlineRedeemFee, parseOnlineRedeemFee } from '@/lib/online-redeem-fee'

export async function GET() {
  const guard = await requirePermission('commission', 'view')
  if (!guard.ok) return guard.response
  return NextResponse.json({ fee: await getOnlineRedeemFee(prisma) }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Set the online Platform Fee. It applies to every online redemption requested from now on. */
export async function POST(req: NextRequest) {
  const guard = await requirePermission('commission', 'manage')
  if (!guard.ok) return guard.response
  const body: unknown = await req.json().catch(() => null)
  const parsed = parseOnlineRedeemFee(body)
  if (!parsed.ok) return NextResponse.json({ error: 'Check the highlighted fields.', errors: parsed.errors }, { status: 400 })
  // This decides what is taken from customers' savings, so a change needs the approver's PIN, like commission rates.
  const pin = body && typeof body === 'object' ? (body as { pin?: unknown }).pin : undefined
  if (!pin) return NextResponse.json({ error: 'Approval PIN required' }, { status: 400 })
  const pinCheck = await verifyApprovalPin(guard.session, pin)
  if (!pinCheck.ok) return pinCheck.response

  const before = await getOnlineRedeemFee(prisma)
  const v = parsed.value
  const value = JSON.stringify(v)
  await prisma.$transaction([
    prisma.platformSetting.upsert({ where: { key: ONLINE_REDEEM_FEE_KEY }, create: { key: ONLINE_REDEEM_FEE_KEY, value }, update: { value } }),
    prisma.auditLog.create({ data: {
      action: 'online_redeem_fee_changed', entity: 'PlatformSetting', entityId: ONLINE_REDEEM_FEE_KEY,
      actorType: guard.actor.type, actorId: guard.actor.id, actorName: guard.actor.name,
      details: `Online Platform Fee changed: at the end ${before.maturedPct}% → ${v.maturedPct}%, early ${before.earlyPct}% → ${v.earlyPct}%, agent’s share ${before.agentSharePct}% → ${v.agentSharePct}%`,
    } }),
  ])
  return NextResponse.json({ fee: v })
}
