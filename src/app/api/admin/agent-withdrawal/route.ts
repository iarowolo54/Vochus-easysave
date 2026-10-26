import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const rows = await prisma.agentWithdrawal.findMany({
    orderBy: { requestedAt: 'desc' },
  })
  const agentIds = Array.from(new Set(rows.map(r => r.agentId)))
  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, agentId: true, name: true, phone: true, commissionBalance: true },
  })
  const agentMap = new Map(agents.map(a => [a.id, a]))

  const records = rows.map(r => {
    const a = agentMap.get(r.agentId)
    return {
      ...r,
      agentName: a?.name ?? '—',
      agentDisplayId: a?.agentId ?? '—',
      agentPhone: a?.phone ?? '—',
      agentCommissionBalance: a?.commissionBalance ?? 0,
    }
  })

  const pending = rows.filter(r => ['Pending', 'AwaitingOTP'].includes(r.status)).length
  const approved = rows.filter(r => r.status === 'Approved').length
  const rejected = rows.filter(r => r.status === 'Rejected').length
  const totalPaidOut = rows.filter(r => r.status === 'Approved').reduce((s, r) => s + r.amount, 0)

  return NextResponse.json({ pending, approved, rejected, totalPaidOut, records })
}
