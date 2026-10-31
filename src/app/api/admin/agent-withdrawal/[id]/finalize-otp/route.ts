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
  } catch (err: any) {
    // Paystack rejected the OTP (nothing was sent): hand the claim back so the admin can retry.
    await prisma.agentWithdrawal.updateMany({ where: { id, status: 'Finalizing' }, data: { status: 'AwaitingOTP' } })
    return NextResponse.json({ error: `Paystack OTP finalisation failed: ${err.message}` }, { status: 502 })
  }

  const adminUser = session.user as { name?: string }
  const decidedBy = adminUser.name ?? 'Super Admin'

  await prisma.agentWithdrawal.updateMany({
    where: { id, status: 'Finalizing' },
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
