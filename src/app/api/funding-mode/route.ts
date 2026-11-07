import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getFundingMode } from '@/lib/funding-mode'

// Which top-up method is in force for agents and for customers, so their screens show the right one. Not secret (it
// is what the screen shows anyway); the payment routes enforce it on the server either way.
export async function GET() {
  return NextResponse.json({ mode: await getFundingMode(prisma) }, { headers: { 'Cache-Control': 'no-store' } })
}
