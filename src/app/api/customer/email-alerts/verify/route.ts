// Confirms the code and turns email alerts on. Marks the address verified only on a right code.
import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { normalizeEmail } from '@/lib/email'
import { checkEmailCode } from '@/lib/email-code'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body: unknown = await req.json().catch(() => null)
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })

  const c = await prisma.customer.findUnique({ where: { id: session.id }, select: { id: true, email: true, firstName: true, lastName: true, customerId: true } })
  if (!c?.email) return NextResponse.json({ error: 'There is no email on your account.' }, { status: 400 })

  const checked = await checkEmailCode(normalizeEmail(c.email), code)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status })

  await prisma.customer.update({ where: { id: c.id }, data: { emailVerifiedAt: new Date(), emailAlertsOn: true } })
  logAudit({
    action: 'customer_email_confirmed', entity: 'Customer', entityId: c.id,
    details: `${c.firstName} ${c.lastName} (${c.customerId}) confirmed their email and turned on email alerts`,
    actorType: 'customer', actorId: c.id, actorName: `${c.firstName} ${c.lastName}`,
  })
  return NextResponse.json({ emailVerified: true, emailAlertsOn: true })
}
