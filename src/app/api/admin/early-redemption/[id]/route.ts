import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { createRecipient, initiateTransfer } from '@/lib/paystack'
import { money } from '@/lib/wallet-guard'
import { logAudit } from '@/lib/audit'

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const { action, pin } = await req.json()

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

  const record = await prisma.earlyRedemption.findUnique({
    where: { id },
    include: {
      savingsPlan: {
        include: { customer: { select: { agentId: true, id: true, firstName: true, lastName: true } } },
      },
    },
  })

  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!['Pending', 'TokenValidated', 'AgentApproved'].includes(record.status)) return NextResponse.json({ error: 'Already decided' }, { status: 400 })

  const adminUser = session.user as { name?: string }
  const decidedBy = adminUser.name ?? 'Super Admin'

  if (action === 'reject') {
    const customerName = `${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName}`
    const planBalance = record.savingsPlan.balance
    const agentForBal = await prisma.agent.findUnique({
      where: { id: record.savingsPlan.customer.agentId },
      select: { walletBalance: true, name: true },
    })

    await prisma.$transaction([
      prisma.earlyRedemption.update({
        where: { id },
        data: { status: 'Rejected', decidedAt: new Date(), decidedBy },
      }),
      prisma.savingsPlan.update({
        where: { id: record.savingsPlanId },
        data: { status: 'Active' },
      }),
    ])

    logAudit({
      action: 'early_redemption_rejected',
      entity: 'EarlyRedemption',
      entityId: id,
      details: `Admin rejected ${record.ref} — customer ${customerName} balance ₦${planBalance.toLocaleString()} restored to Active | agent wallet ₦${(agentForBal?.walletBalance ?? 0).toLocaleString()}`,
      actorType: 'admin',
      actorId: (session.user as any).id,
      actorName: decidedBy,
    })
    return NextResponse.json({ ok: true, status: 'Rejected' })
  }

  if (action === 'approve') {
    const agentId = record.savingsPlan.customer.agentId
    const customerId = record.savingsPlan.customer.id
    const isBankTransfer = record.payoutMethod === 'Bank Transfer' || record.payoutMethod === 'BankTransfer'

    let paystackRecipientCode: string | null = null
    let paystackTransferCode: string | null = null
    let bankTransferStatus: string | null = null

    if (isBankTransfer) {
      if (!record.accountNumber || !record.bankCode || !record.accountName) {
        return NextResponse.json({ error: 'Bank account details missing on this redemption record' }, { status: 400 })
      }
      try {
        const customerName = `${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName}`
        paystackRecipientCode = await createRecipient(
          record.accountName,
          record.accountNumber,
          record.bankCode,
        )
        const transfer = await initiateTransfer(
          record.netPayout,
          paystackRecipientCode,
          `Vochus Easy Save redemption — ${customerName} (${record.ref})`,
          record.ref,
        )
        paystackTransferCode = transfer.transferCode
        bankTransferStatus = transfer.status

        // Paystack requires OTP finalisation — pause and wait for admin to enter it.
        if (transfer.status === 'otp') {
          await prisma.earlyRedemption.update({
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
            message: 'Paystack has sent an OTP to your transfer-approval phone. Enter it to complete the payout.',
          })
        }
      } catch (err: any) {
        return NextResponse.json({ error: `Paystack transfer failed: ${err.message}` }, { status: 502 })
      }
    }

    const agentComm = money(record.penalty * (3 / 5))
    const platformFee = money(record.penalty * (2 / 5))
    const revenueCredit = platformFee

    const agentForBalance = await prisma.agent.findUnique({ where: { id: agentId }, select: { walletBalance: true } })
    const walletAfter = isBankTransfer
      ? (agentForBalance?.walletBalance ?? 0)
      : (agentForBalance?.walletBalance ?? 0) + record.netPayout

    await prisma.$transaction([
      prisma.earlyRedemption.update({
        where: { id },
        data: {
          status: 'Approved',
          decidedAt: new Date(),
          decidedBy,
          ...(isBankTransfer && {
            paystackRecipientCode,
            paystackTransferCode,
            bankTransferStatus,
          }),
        },
      }),
      prisma.savingsPlan.update({
        where: { id: record.savingsPlanId },
        data: { status: 'Redeemed', balance: 0 },
      }),
      prisma.platformWallet.upsert({
        where: { type: 'Revenue' },
        update: { balance: { increment: revenueCredit } },
        create: { type: 'Revenue', balance: revenueCredit },
      }),
      prisma.agent.update({
        where: { id: agentId },
        data: {
          commissionBalance: { increment: agentComm },
          // For cash payout the agent physically pays out; credit their wallet back with netPayout.
          // For bank transfer Paystack pays directly so no wallet credit.
          ...(isBankTransfer ? {} : { walletBalance: { increment: record.netPayout } }),
        },
      }),
      prisma.transaction.create({
        data: {
          ref: record.ref,
          agentId,
          customerId,
          planId: record.savingsPlanId,
          type: 'redemption',
          amount: record.netPayout,
          method: record.payoutMethod ?? 'Cash',
          status: 'Done',
          walletAfter,
        },
      }),
    ])

    logAudit({
      action: 'early_redemption_approved',
      entity: 'EarlyRedemption',
      entityId: id,
      details: `Admin approved ${record.ref} — payout ₦${record.netPayout.toLocaleString()} via ${record.payoutMethod ?? 'Cash'} | customer ${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName} balance ₦${record.balance.toLocaleString()} → ₦0 | agent wallet after ₦${walletAfter.toLocaleString()}`,
      actorType: 'admin',
      actorId: (session.user as any).id,
      actorName: decidedBy,
    })
    return NextResponse.json({ ok: true, status: 'Approved', bankTransferStatus })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
