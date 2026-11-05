// The customer's on/off switch for sign-in and payment emails. Only works once their email is confirmed.
import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body: unknown = await req.json().catch(() => null)
  const on = typeof body === 'object' && body !== null ? (body as { on?: unknown }).on : undefined
  if (typeof on !== 'boolean') return NextResponse.json({ error: 'Choose on or off' }, { status: 400 })

  // The owner is in the where, so this can only change the signed-in customer's own row.
  const res = await prisma.customer.updateMany({ where: { id: session.id, emailVerifiedAt: { not: null } }, data: { emailAlertsOn: on } })
  if (res.count !== 1) return NextResponse.json({ error: 'Confirm your email first' }, { status: 409 })
  return NextResponse.json({ emailAlertsOn: on })
}
