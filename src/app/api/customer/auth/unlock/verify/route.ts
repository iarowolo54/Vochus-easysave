import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { unlockAccount } from '@/lib/login-attempt'
import { verifyUnlockOtp } from '@/lib/unlock-otp'
import { logAudit } from '@/lib/audit'
import { limitByIp } from '@/lib/password-reset'

// Verify an unlock code. On success the account lock is cleared; the customer
// then logs in again with their password. The OTP does NOT log them in.
export async function POST(req: NextRequest) {
  const limited = limitByIp(req, 'guess')
  if (limited) return limited

  const { phone, code } = await req.json().catch(() => ({}))
  if (!phone || typeof phone !== 'string' || !code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Phone and code required' }, { status: 400 })
  }

  const customer = await prisma.customer.findFirst({
    where: { phone: phone.trim() },
    select: { id: true, firstName: true, lastName: true, customerId: true },
  })
  // Neutral failure whether or not the account exists.
  if (!customer) return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })

  const { ok } = await verifyUnlockOtp(customer.id, code)
  if (!ok) return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })

  await unlockAccount(phone)

  logAudit({
    action: 'customer_account_unlocked',
    entity: 'Customer',
    entityId: customer.id,
    details: `${customer.firstName} ${customer.lastName} (${customer.customerId}) unlocked their account via OTP`,
    actorType: 'customer',
    actorId: customer.id,
    actorName: `${customer.firstName} ${customer.lastName}`,
  })

  return NextResponse.json({ ok: true })
}
