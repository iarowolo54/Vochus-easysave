import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isPhoneLocked } from '@/lib/login-attempt'
import { limitByIp } from '@/lib/password-reset'
import { requestUnlockOtp } from '@/lib/unlock-otp'

// Send an unlock code to a locked customer, on their registration channel
// (email for link-registered, SMS for agent-registered). The code is never
// returned, and the answer is the same whether or not a code was sent.
export async function POST(req: NextRequest) {
  const limited = limitByIp(req, 'request')
  if (limited) return limited

  const { phone } = await req.json().catch(() => ({}))
  if (!phone || typeof phone !== 'string') {
    return NextResponse.json({ error: 'Phone required' }, { status: 400 })
  }

  try {
    const customer = await prisma.customer.findFirst({
      where: { phone: phone.trim() },
      select: { id: true, email: true, phone: true, firstName: true },
    })
    if (customer && (await isPhoneLocked(phone))) await requestUnlockOtp(customer)
  } catch {
    console.error('Customer unlock request failed')
  }

  return NextResponse.json({ ok: true })
}
