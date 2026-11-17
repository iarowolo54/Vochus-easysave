import { NextRequest, NextResponse } from 'next/server'
import { requirePermission, adminActor } from '@/lib/admin-guard'
import { cleanNote } from '@/lib/manual-credit'
import { markKoboChecked } from '@/lib/transfer-report'

/** Staff mark a "sent without the extra kobo" report as checked, so it leaves the banner. No money moves. */
export async function POST(req: NextRequest) {
  const guard = await requirePermission('bank-transfers', 'manage')
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const note = cleanNote(b.note)
  if (!note) return NextResponse.json({ error: 'Add a short note saying what you found (3 to 300 characters).' }, { status: 400 })
  if (typeof b.intentId !== 'string' || !b.intentId) return NextResponse.json({ error: 'Missing request.' }, { status: 400 })

  const r = await markKoboChecked(b.intentId, { id: adminActor(guard.session).actorId, name: guard.actor.name }, note)
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
}
