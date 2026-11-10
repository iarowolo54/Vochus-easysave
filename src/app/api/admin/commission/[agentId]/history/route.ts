import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { sumCommission, COMMISSION_SOURCES, type CommissionSource } from '@/lib/commission-history'
import { loadCommissionEntries } from '@/lib/commission-entries'

export async function GET(req: NextRequest, context: { params: Promise<{ agentId: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response

  const { agentId } = await context.params
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, name: true, agentId: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const sp = req.nextUrl.searchParams
  const from = sp.get('from') || undefined
  const to = sp.get('to') || undefined
  const DAY = /^\d{4}-\d{2}-\d{2}$/
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 })
  }
  const sourcesParam = (sp.get('sources') || '').split(',').map(s => s.trim()).filter(Boolean)
  const sources = sourcesParam.filter((s): s is CommissionSource => (COMMISSION_SOURCES as readonly string[]).includes(s))
  const want = (s: CommissionSource) => sources.length === 0 || sources.includes(s)

  // Local day boundaries (matches what the drawer sends). Date filters applied in-query.
  const fromDate = from ? new Date(`${from}T00:00:00.000`) : undefined
  const toDate = to ? new Date(`${to}T23:59:59.999`) : undefined

  const entries = await loadCommissionEntries(agent.id, { from: fromDate, to: toDate, want })
  entries.sort((x, y) => y.date.localeCompare(x.date))

  return NextResponse.json({
    agent,
    entries,
    total: sumCommission(entries),
    count: entries.length,
  })
}
