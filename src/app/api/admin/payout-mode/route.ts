import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { getPayoutMode, type PayoutChannel, type PayoutMode } from '@/lib/payout-mode'
import { PAYSTACK_ENABLED } from '@/lib/paystack-off'

const SETTING_KEY = 'payoutMode'
const CHANNELS: PayoutChannel[] = ['agent', 'customer']
const VALID_MODES: PayoutMode[] = ['auto', 'manual']

export async function GET() {
  const guard = await requirePermission('payout-mode', 'view')
  if (!guard.ok) return guard.response

  return NextResponse.json({ mode: await getPayoutMode() })
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('payout-mode', 'manage')
  if (!guard.ok) return guard.response
  const session = guard.session

  const body = await req.json().catch(() => null)
  const mode: unknown = body && typeof body === 'object' ? (body as { mode?: unknown }).mode : undefined
  if (!mode || typeof mode !== 'object') return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const next = mode as Record<string, unknown>
  for (const ch of CHANNELS) {
    const v = next[ch]
    if (typeof v !== 'string' || !VALID_MODES.includes(v as PayoutMode)) {
      return NextResponse.json({ error: `Invalid mode for ${ch}` }, { status: 400 })
    }
  }
  const value = { agent: next.agent as PayoutMode, customer: next.customer as PayoutMode }
  if (!PAYSTACK_ENABLED && (value.agent === 'auto' || value.customer === 'auto')) {
    return NextResponse.json({ error: 'Automatic payouts need Paystack, which is closed. Payouts stay on Manual.' }, { status: 409 })
  }

  const before = await getPayoutMode()

  await prisma.platformSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(value) },
    create: { key: SETTING_KEY, value: JSON.stringify(value) },
  })

  logAudit({
    action: 'payout_mode_updated',
    entity: 'PlatformSetting',
    details: `agent ${before.agent}→${value.agent}, customer ${before.customer}→${value.customer}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true })
}
