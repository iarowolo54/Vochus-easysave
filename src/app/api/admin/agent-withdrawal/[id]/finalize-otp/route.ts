import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { finalizeTransfer, PaystackRejected } from '@/lib/paystack'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('agents')
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const { otp } = await req.json()
  if (!otp) return NextResponse.json({ error: 'OTP required' }, { status: 400 })

  const record = await prisma.agentWithdrawal.findUnique({ where: { id } })
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (record.status !== 'AwaitingOTP') return NextResponse.json({ error: 'Already processed' }, { status: 409 })
  if (!record.paystackTransferCode) return NextResponse.json({ error: 'Missing Paystack transfer code on record' }, { status: 400 })

  // Claim BEFORE Paystack: AwaitingOTP -> Finalizing. A concurrent submit claims nothing and never finalizes.
  const claim = await prisma.agentWithdrawal.updateMany({
    where: { id, status: 'AwaitingOTP' },
    data: { status: 'Finalizing' },
  })
  if (claim.count === 0) return NextResponse.json({ error: 'Already processed' }, { status: 409 })

  let finalStatus: string
  try {
    const r = await finalizeTransfer(record.paystackTransferCode, String(otp))
    finalStatus = r.status
  } catch (err: unknown) {
    if (err instanceof PaystackRejected) {
      // Definite rejection (e.g. wrong OTP): nothing was sent, so hand the claim back for a retry.
      try {
        await prisma.agentWithdrawal.updateMany({ where: { id, status: 'Finalizing' }, data: { status: 'AwaitingOTP' } })
      } catch (relErr) {
        console.error('agent-withdrawal finalize-otp: claim release failed', id, relErr instanceof Error ? relErr.name : 'unknown')
      }
      return NextResponse.json({ error: `Paystack rejected the OTP: ${err.message}` }, { status: 400 })
    }
    // Timeout / network / unknown: Paystack may have accepted the finalize. Do NOT release the claim.
    console.error('agent-withdrawal finalize-otp: outcome unknown, left Finalizing', id, err instanceof Error ? err.name : 'unknown')
    return NextResponse.json({ error: 'Could not confirm the Paystack finalisation. It is being verified; do not retry. Contact support.' }, { status: 502 })
  }

  const decidedBy = guard.actor.name

  try {
    const fin = await prisma.agentWithdrawal.updateMany({
      where: { id, status: 'Finalizing' },
      data: { status: 'Approved', decidedAt: new Date(), decidedBy, bankTransferStatus: finalStatus },
    })
    if (fin.count === 0) throw new Error('Finalizing claim lost')
  } catch (err) {
    // Paystack already accepted the finalize; leave the record in Finalizing (never re-finalizable) for reconciliation.
    console.error('agent-withdrawal finalize-otp: post-finalize write failed', id, err instanceof Error ? err.name : 'unknown')
    return NextResponse.json({ error: 'Transfer finalised but the record update failed. Verify with Paystack; do not retry.' }, { status: 502 })
  }

  logAudit({
    action: 'agent_withdrawal_finalize',
    entity: 'AgentWithdrawal',
    entityId: record.id,
    details: `${decidedBy} finalised OTP for ${record.ref} (₦${record.amount}) — Paystack status: ${finalStatus}`,
    actorType: guard.actor.type,
    actorId: guard.actor.id,
    actorName: guard.actor.name,
  })

  return NextResponse.json({ ok: true, status: 'Approved', bankTransferStatus: finalStatus })
}
