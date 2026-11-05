// Sends a confirmation code to the signed-in customer's own email on file. The address is never taken from the request.
import { NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-auth'
import { prisma } from '@/lib/prisma'
import { normalizeEmail } from '@/lib/email'
import { sendEmailCode } from '@/lib/email-code'
import { enrolRateLimiter } from '@/lib/rate-limit'

export async function POST() {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!enrolRateLimiter.check(`email-alerts-code:${session.id}`, 10, 60 * 60 * 1000).allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }
  const c = await prisma.customer.findUnique({ where: { id: session.id }, select: { email: true } })
  if (!c?.email) return NextResponse.json({ error: 'There is no email on your account.' }, { status: 400 })
  const sent = await sendEmailCode(normalizeEmail(c.email))
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status })
  return NextResponse.json({ sent: true })
}
