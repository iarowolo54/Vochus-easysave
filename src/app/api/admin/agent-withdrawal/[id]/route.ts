import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { createRecipient, initiateTransfer, resolveAccount } from '@/lib/paystack'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(adminAuthOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await context.params
  const { action, pin, adminNote } = await req.json()

  if (action === 'approve') {
    if (!pin) return NextResponse.json({ error: 'Approval PIN required' }, { status: 400 })
    const adminId = (session.user as any).id
    const adminEmail = (session.user as any).email
    const admin = await prisma.superAdmin.findFirst({
      where: adminId ? { id: adminId } : { email: adminEmail },
    })
    if (!admin?.approvalPin) return NextResponse.json({ error: 'No approval PIN set. Contact system administrator.' }, { status: 403 })
    const valid = await bcrypt.compare(String(pin), admin.approvalPin)
    if (!valid) return NextResponse.json({ error: 'Incorrect PIN' }, { status: 403 })
  }

  const record = await prisma.agentWithdrawal.findUnique({ where: { id } })
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!['Pending'].includes(record.status)) return NextResponse.json({ error: `Withdrawal is in ${record.status} state` }, { status: 400 })

  const agent = await prisma.agent.findUnique({ where: { id: record.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const adminUser = session.user as { name?: string }
  const decidedBy = adminUser.name ?? 'Super Admin'

  if (action === 'reject') {
    await prisma.$transaction([
      prisma.agentWithdrawal.update({
        where: { id },
        data: { status: 'Rejected', decidedAt: new Date(), decidedBy, adminNote: adminNote || null },
      }),
      prisma.agent.update({
        where: { id: agent.id },
        data: { commissionBalance: { increment: record.amount } },
      }),
    ])
    logAudit({
      action: 'agent_withdrawal_reject',
      entity: 'AgentWithdrawal',
      entityId: record.id,
      details: `${decidedBy} rejected ₦${record.amount} withdrawal for ${agent.name} (${agent.agentId}) — refunded to commission balance`,
      actorType: 'superadmin',
      actorName: decidedBy,
    })
    return NextResponse.json({ ok: true, status: 'Rejected' })
  }

  if (action === 'approve') {
    if (!record.accountNumber || !record.bankCode) {
      return NextResponse.json({ error: 'Bank account details missing on this withdrawal record' }, { status: 400 })
    }

    let recipientName = record.accountName ?? ''
    if (!recipientName) {
      try {
        const r = await resolveAccount(record.accountNumber, record.bankCode)
        recipientName = r.accountName
      } catch {
        recipientName = agent.name
      }
      await prisma.agentWithdrawal.update({ where: { id }, data: { accountName: recipientName } })
    }

    let paystackRecipientCode: string | null = null
    let paystackTransferCode: string | null = null
    let bankTransferStatus: string | null = null

    try {
      paystackRecipientCode = await createRecipient(
        recipientName,
        record.accountNumber,
        record.bankCode,
      )
      const transfer = await initiateTransfer(
        record.amount,
        paystackRecipientCode,
        `Vochus Easy Save commission payout — ${agent.name} (${record.ref})`,
        record.ref,
      )
      paystackTransferCode = transfer.transferCode
      bankTransferStatus = transfer.status

      if (transfer.status === 'otp') {
        await prisma.agentWithdrawal.update({
          where: { id },
          data: {
            status: 'AwaitingOTP',
            paystackRecipientCode,
            paystackTransferCode,
            bankTransferStatus,
          },
        })
        return NextResponse.json({
          ok: true,
          status: 'AwaitingOTP',
          transferCode: paystackTransferCode,
          message: 'Paystack has sent an OTP — enter it to complete the payout.',
        })
      }

      if (transfer.status === 'failed' || transfer.status === 'reversed') {
        return NextResponse.json({
          error: `Paystack transfer ${transfer.status}. Reason: ${(transfer as any).raw?.gateway_response ?? 'unknown'}. Check your Paystack balance and try again.`,
        }, { status: 502 })
      }
    } catch (err: any) {
      return NextResponse.json({ error: `Paystack transfer failed: ${err.message}` }, { status: 502 })
    }

    // 'success' = money moved; 'pending' = queued on Paystack side, verify later
    const finalStatus = bankTransferStatus === 'success' ? 'Approved' : 'Processing'

    await prisma.agentWithdrawal.update({
      where: { id },
      data: {
        status: finalStatus,
        decidedAt: new Date(),
        decidedBy,
        adminNote: adminNote || null,
        paystackRecipientCode,
        paystackTransferCode,
        bankTransferStatus,
      },
    })

    logAudit({
      action: 'agent_withdrawal_approve',
      entity: 'AgentWithdrawal',
      entityId: record.id,
      details: `${decidedBy} approved ₦${record.amount} withdrawal for ${agent.name} (${agent.agentId}) — Paystack: ${bankTransferStatus}, internal: ${finalStatus}`,
      actorType: 'superadmin',
      actorName: decidedBy,
    })

    return NextResponse.json({ ok: true, status: finalStatus, bankTransferStatus })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
