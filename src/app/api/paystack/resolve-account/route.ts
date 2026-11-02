import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCustomerSession } from '@/lib/customer-auth'
import { resolveAccount } from '@/lib/paystack'
import { clientIp, createRateLimiter } from '@/lib/rate-limit'

const TEN_MIN_MS = 10 * 60_000
const limiter = createRateLimiter()

/** Looks up an account name, for a signed-in agent or customer only: each lookup is a Paystack call and reveals a person's name. */
async function lookup(req: NextRequest, accountNumber: unknown, bankCode: unknown) {
  const agent = await getServerSession(authOptions)
  const actor = agent?.user?.agentId ? `agent:${agent.user.agentId}` : (await getCustomerSession().then(c => (c ? `customer:${c.id}` : null)))
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (typeof accountNumber !== 'string' || typeof bankCode !== 'string' || !accountNumber || !bankCode) {
    return NextResponse.json({ error: 'accountNumber and bankCode required' }, { status: 400 })
  }
  if (!/^\d{10}$/.test(accountNumber) || !/^[A-Za-z0-9]{2,12}$/.test(bankCode)) {
    return NextResponse.json({ error: 'Enter a valid 10-digit account number and bank' }, { status: 400 })
  }

  const ip = clientIp(req)
  const byActor = limiter.check(actor, 30, TEN_MIN_MS)
  const byIp = ip === 'unknown' ? byActor : limiter.check(`ip:${ip}`, 120, TEN_MIN_MS)
  if (!byActor.allowed || !byIp.allowed) {
    return NextResponse.json({ error: 'Too many lookups. Please wait a few minutes and try again.' }, { status: 429 })
  }

  try {
    return NextResponse.json(await resolveAccount(accountNumber, bankCode))
  } catch {
    return NextResponse.json({ error: 'Could not resolve account' }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return lookup(req, searchParams.get('accountNumber'), searchParams.get('bankCode'))
}

export async function POST(req: NextRequest) {
  const body: { accountNumber?: unknown; bankCode?: unknown } | null = await req.json().catch(() => null)
  return lookup(req, body?.accountNumber, body?.bankCode)
}
