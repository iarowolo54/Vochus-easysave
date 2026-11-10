import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { denyCustomerRequest } from '@/lib/customer-request'
import { emailRequestDenied } from '@/lib/customer-request-email'

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('customer-requests', 'manage')
  if (!guard.ok) return guard.response
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { reason?: unknown; fix?: unknown } | null
  const reason = clean(body?.reason)
  const fix = clean(body?.fix)
  if (reason.length < 3 || reason.length > 500) return NextResponse.json({ error: 'Say why it’s denied (3 to 500 characters).' }, { status: 400 })
  if (fix.length < 3 || fix.length > 500) return NextResponse.json({ error: 'Say what the agent should work on (3 to 500 characters).' }, { status: 400 })
  const r = await denyCustomerRequest(prisma, { id, admin: guard.actor, reason, fix })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  void emailRequestDenied(r.agent, { customerName: r.customerName, reason, fix })
  return NextResponse.json({ ok: true })
}
