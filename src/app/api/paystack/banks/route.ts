import { NextResponse } from 'next/server'
import { listBanks } from '@/lib/paystack'

let cache: { data: { code: string; name: string }[]; at: number } | null = null

export async function GET() {
  try {
    if (cache && Date.now() - cache.at < 60 * 60 * 1000) {
      return NextResponse.json({ banks: cache.data })
    }
    const raw = await listBanks()
    const seen = new Set<string>()
    const banks = raw.filter(b => { if (seen.has(b.code)) return false; seen.add(b.code); return true })
    // Paystack test bank (code 001) doesn't appear in the list API but works for resolve/transfer in test mode
    if (process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')) {
      banks.unshift({ code: '001', name: 'Test Bank (Paystack)' })
    }
    cache = { data: banks, at: Date.now() }
    return NextResponse.json({ banks })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to fetch banks' }, { status: 500 })
  }
}
