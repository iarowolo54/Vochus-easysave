import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveAccount } from '@/lib/paystack'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const accountNumber = searchParams.get('accountNumber')
  const bankCode = searchParams.get('bankCode')
  if (!accountNumber || !bankCode) return NextResponse.json({ error: 'accountNumber and bankCode required' }, { status: 400 })
  try {
    const result = await resolveAccount(accountNumber, bankCode)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Could not resolve account' }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { accountNumber, bankCode } = await req.json()
  if (!accountNumber || !bankCode) return NextResponse.json({ error: 'accountNumber and bankCode required' }, { status: 400 })

  try {
    const result = await resolveAccount(accountNumber, bankCode)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Could not resolve account' }, { status: 400 })
  }
}
