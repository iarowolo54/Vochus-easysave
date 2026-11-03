import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isPhoneLocked } from '@/lib/login-attempt'
import { limitByIp, newResetId } from '@/lib/password-reset'
import { clientIp } from '@/lib/rate-limit'
import { requestUnlockOtp } from '@/lib/unlock-otp'

// Send an unlock code to a locked customer, to a verified email or else by
// SMS. The code is never
// returned, and the answer is the same whether or not a code was sent: unknown,
// unlocked and cooling-down accounts get a random resetId.
export async function POST(req: NextRequest) {
  const limited = limitByIp(req, 'request')
  if (limited) return limited

  const { phone } = await req.json().catch(() => ({}))
  if (!phone || typeof phone !== 'string') {
    return NextResponse.json({ error: 'Phone required' }, { status: 400 })
  }

  let resetId = newResetId()
  try {
    const customer = await prisma.customer.findFirst({
      where: { phone: phone.trim() },
      select: { id: true, email: true, emailVerifiedAt: true, phone: true, firstName: true },
    })
    const issued = customer && (await isPhoneLocked(phone)) ? await requestUnlockOtp(customer, Date.now(), undefined, clientIp(req)) : null
    if (issued) resetId = issued.resetId
  } catch {
    console.error('Customer unlock request failed')
  }

  return NextResponse.json({ ok: true, resetId })
}
