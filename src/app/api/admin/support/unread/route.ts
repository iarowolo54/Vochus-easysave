import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { adminUnreadThreads } from '@/lib/support-chat'

export const dynamic = 'force-dynamic'

/** Conversations waiting for the office, for the nav badge. Read-only: opening a thread is what marks it read. */
export async function GET() {
  const guard = await requirePermission('support', 'view')
  if (!guard.ok) return guard.response
  const count = await adminUnreadThreads(prisma)
  return NextResponse.json({ count }, { headers: { 'Cache-Control': 'no-store' } })
}
