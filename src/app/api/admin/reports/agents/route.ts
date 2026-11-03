import { requirePermission } from '@/lib/admin-guard'
import { agentReportCsv, buildAgentReport } from '@/lib/agent-report'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requirePermission('reports', 'view')
  if (!guard.ok) return guard.response

  const now = new Date()
  const csv = agentReportCsv(await buildAgentReport(now))
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="agent-report-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
