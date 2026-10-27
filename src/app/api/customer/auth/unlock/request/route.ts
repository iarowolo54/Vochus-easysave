import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isPhoneLocked } from '@/lib/login-attempt'
import { requestUnlockOtp } from '@/lib/unlock-otp'

// Send an unlock code to a locked customer, on their registration channel
// (email for link-registered, SMS for agent-registered). The code is never
// returned. We only send when the account is actually locked; for anything else
// we return a neutral ok so this can't be used to probe accounts beyond what the
// login 423 already tells the user.
export async function POST(req: NextRequest) {
  const { phone } = await req.json().catch(() => ({}))
  if (!phone || typeof phone !== 'string') {
    return NextResponse.json({ error: 'Phone required' }, { status: 400 })
  }

  const customer = await prisma.customer.findFirst({
    where: { phone: phone.trim() },
    select: { id: true, email: true, phone: true, firstName: true },
  })

  if (!customer || !(await isPhoneLocked(phone))) {
    return NextResponse.json({ ok: true }) // neutral — nothing sent
  }

  const result = await requestUnlockOtp(customer)
  if (!result.sent) {
    if (result.retryAfterSeconds) {
      return NextResponse.json(
        { error: `Please wait before requesting another code.`, retryAfterSeconds: result.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
      )
    }
    return NextResponse.json({ error: 'Could not send the code. Try again shortly.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, channel: result.channel, sentTo: result.maskedTarget })
}
