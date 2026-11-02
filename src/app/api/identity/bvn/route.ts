import { NextRequest, NextResponse } from 'next/server'
import { resolveBvn } from '@/lib/paystack'
import { refuseBvnLookup } from '@/lib/bvn-lookup'
import { enrolRateLimiter, clientIp } from '@/lib/rate-limit'

// Public, so it needs a verified email (see bvn-lookup) and returns only the name the enrol page compares.
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!enrolRateLimiter.check(`bvn:ip:${ip}`, 60, 60 * 1000).allowed) {
    return NextResponse.json({ ok: false, error: 'Too many requests. Please try again shortly.' }, { status: 429 })
  }

  const { bvn, email } = await req.json().catch(() => ({}))
  if (!bvn || !/^\d{11}$/.test(String(bvn))) {
    return NextResponse.json({ ok: false, error: 'BVN must be 11 digits' }, { status: 400 })
  }

  const refused = await refuseBvnLookup(email, ip)
  if (refused) return NextResponse.json({ ok: false, error: refused.error }, { status: refused.status })

  try {
    const r = await resolveBvn(String(bvn))
    return NextResponse.json({ ok: true, firstName: r.firstName, lastName: r.lastName })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'BVN verification failed' }, { status: 400 })
  }
}
