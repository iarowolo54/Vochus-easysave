import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { finalizeTransfer } from '@/lib/paystack'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const { otp } = await req.json()
  if (!otp) return NextResponse.json({ error: 'OTP required' }, { status: 400 })

  const record = await prisma.agentWithdrawal.findUnique({ where: { id } })
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (record.status !== 'AwaitingOTP') return NextResponse.json({ error: `Withdrawal is in ${record.status} state, not AwaitingOTP` }, { status: 400 })
  if (!record.paystackTransferCode) return NextResponse.json({ error: 'Missing Paystack transfer code on record' }, { status: 400 })

  let finalStatus: string
  try {
    const r = await finalizeTransfer(record.paystackTransferCode, String(otp))
    finalStatus = r.status
  } catch (err: any) {
    return NextResponse.json({ error: `Paystack OTP finalisation failed: ${err.message}` }, { status: 502 })
  }

  const adminUser = session.user as { name?: string }
  const decidedBy = adminUser.name ?? 'Super Admin'

  await prisma.agentWithdrawal.update({
    where: { id },
    data: {
      status: 'Approved',
      decidedAt: new Date(),
      decidedBy,
      bankTransferStatus: finalStatus,
    },
  })

  logAudit({
    action: 'agent_withdrawal_finalize',
    entity: 'AgentWithdrawal',
    entityId: record.id,
    details: `${decidedBy} finalised OTP for ${record.ref} (₦${record.amount}) — Paystack status: ${finalStatus}`,
    actorType: 'superadmin',
    actorName: decidedBy,
  })

  return NextResponse.json({ ok: true, status: 'Approved', bankTransferStatus: finalStatus })
}
