import { NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cron-auth'
import { pollMoniepointAlerts } from '@/lib/moniepoint-poll'

export const dynamic = 'force-dynamic'

// Backstop for the customer's own status checks: run every minute from cron with the CRON_SECRET bearer.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await pollMoniepointAlerts())
  } catch (e) {
    // imapflow reports a refused login as just "Command failed"; the reason is on these fields. Never the password.
    const d = (e ?? {}) as { code?: unknown; responseText?: unknown; authenticationFailed?: unknown }
    console.error('[bank-alerts] poll failed:', e instanceof Error ? e.message : 'unknown error', {
      code: d.code, responseText: d.responseText, authenticationFailed: d.authenticationFailed,
    })
    return NextResponse.json({ error: 'Poll failed' }, { status: 502 })
  }
}
