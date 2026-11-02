import { NextRequest, NextResponse } from 'next/server'
import { resolveBvn } from '@/lib/paystack'
import { bvnNameMatches, refuseBvnLookup } from '@/lib/bvn-lookup'
import { enrolRateLimiter, clientIp } from '@/lib/rate-limit'

// Public, so it needs a verified email (see bvn-lookup) and only answers whether the typed name matches.
// No identity field ever leaves this route, and Paystack's error text doesn't either.
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!enrolRateLimiter.check(`bvn:ip:${ip}`, 60, 60 * 1000).allowed) {
    return NextResponse.json({ ok: false, error: 'Too many requests. Please try again shortly.' }, { status: 429 })
  }

  const { bvn, email, firstName, lastName } = await req.json().catch(() => ({}))
  if (!bvn || !/^\d{11}$/.test(String(bvn))) {
    return NextResponse.json({ ok: false, error: 'BVN must be 11 digits' }, { status: 400 })
  }
  if (typeof firstName !== 'string' || typeof lastName !== 'string' || !firstName.trim() || !lastName.trim()) {
    return NextResponse.json({ ok: false, error: 'Enter your first and last name' }, { status: 400 })
  }

  const refused = await refuseBvnLookup(email, ip)
  if (refused) return NextResponse.json({ ok: false, error: refused.error }, { status: refused.status })

  try {
    const r = await resolveBvn(String(bvn))
    return NextResponse.json({ ok: true, match: bvnNameMatches(r, { firstName, lastName }) })
  } catch {
    return NextResponse.json({ ok: false, error: 'We couldn’t check this BVN. Try again, or carry on without it.' }, { status: 400 })
  }
}
