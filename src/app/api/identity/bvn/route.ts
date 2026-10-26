import { NextRequest, NextResponse } from 'next/server'
import { resolveBvn } from '@/lib/paystack'

export async function POST(req: NextRequest) {
  const { bvn } = await req.json().catch(() => ({}))
  if (!bvn || !/^\d{11}$/.test(String(bvn))) {
    return NextResponse.json({ ok: false, error: 'BVN must be 11 digits' }, { status: 400 })
  }
  try {
    const r = await resolveBvn(String(bvn))
    return NextResponse.json({
      ok: true,
      firstName: r.firstName,
      lastName: r.lastName,
      middleName: r.middleName,
      dob: r.dob,
      phone: r.phone,
      gender: r.gender,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'BVN verification failed' }, { status: 400 })
  }
}
