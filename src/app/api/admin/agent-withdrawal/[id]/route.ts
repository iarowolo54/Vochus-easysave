import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { createRecipient, initiateTransfer, PaystackRejected, resolveAccount } from '@/lib/paystack'
import { logAudit } from '@/lib/audit'
import { NO_MONEY_LEFT } from '@/lib/redemption-balance'
import { getPayoutMode } from '@/lib/payout-mode'
import { notifyAgentPayoutPaid, notifyAgentPayoutDeclined } from '@/lib/payout-notify'

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const { action, pin, adminNote } = await req.json()

  if (action === 'approve') {
    if (!pin) return NextResponse.json({ error: 'Approval PIN required' }, { status: 400 })
    const pinCheck = await verifyApprovalPin(session, pin)
    if (!pinCheck.ok) return pinCheck.response
  }

  const record = await prisma.agentWithdrawal.findUnique({ where: { id } })
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (record.status !== 'Pending') return NextResponse.json({ error: 'Already processed' }, { status: 409 })

  const agent = await prisma.agent.findUnique({ where: { id: record.agentId } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const adminUser = session.user as { name?: string }
  const decidedBy = adminUser.name ?? 'Super Admin'

  if (action === 'reject') {
    // Claim the Pending -> Rejected transition first; only the winner refunds.
    const refunded = await prisma.$transaction(async (tx) => {
      const claim = await tx.agentWithdrawal.updateMany({
        where: { id, status: 'Pending' },
        data: { status: 'Rejected', decidedAt: new Date(), decidedBy, adminNote: adminNote || null },
      })
      if (claim.count === 0) return false
      await tx.agent.update({
        where: { id: agent.id },
        data: { commissionBalance: { increment: record.amount } },
      })
      return true
    })
    if (!refunded) return NextResponse.json({ error: 'Already processed' }, { status: 409 })
    logAudit({
      action: 'agent_withdrawal_reject',
      entity: 'AgentWithdrawal',
      entityId: record.id,
      details: `${decidedBy} rejected ₦${record.amount} withdrawal for ${agent.name} (${agent.agentId}) — refunded to commission balance`,
      actorType: 'superadmin',
      actorName: decidedBy,
    })
    // Manual mode only: tell the agent it was declined (Auto stays silent). Best-effort; never throws.
    try {
      if ((await getPayoutMode()).agent === 'manual') {
        await notifyAgentPayoutDeclined(agent, {
          amountNaira: record.amount,
          ref: record.ref,
          reason: adminNote || 'No reason given',
        })
      }
    } catch (e) {
      console.error('[agent-withdrawal] decline notification failed', e instanceof Error ? e.message : e)
    }
    return NextResponse.json({ ok: true, status: 'Rejected' })
  }

  if (action === 'approve') {
    // Fail closed: a mode-read error surfaces as a 500 rather than silently picking a rail.
    const manual = (await getPayoutMode()).agent === 'manual'
    if (manual) {
      // Manual rail: admin pays outside Paystack. Commission was already debited at request
      // time, so no balance change here. Same single conditional claim guards double-approval.
      const claimed = await prisma.agentWithdrawal.updateMany({
        where: { id, status: 'Pending' },
        data: {
          status: 'Approved',
          decidedAt: new Date(),
          decidedBy,
          adminNote: adminNote || null,
          bankTransferStatus: 'manual',
          paystackRecipientCode: null,
          paystackTransferCode: null,
        },
      })
      if (claimed.count === 0) return NextResponse.json({ error: 'Already processed' }, { status: 409 })

      logAudit({
        action: 'agent_withdrawal_approve',
        entity: 'AgentWithdrawal',
        entityId: record.id,
        details: `${decidedBy} approved ₦${record.amount} withdrawal for ${agent.name} (${agent.agentId}) — manual payout (off-Paystack)${adminNote ? `, ref: ${adminNote}` : ''}`,
        actorType: 'superadmin',
        actorName: decidedBy,
      })

      try {
        await notifyAgentPayoutPaid(agent, { amountNaira: record.amount, ref: record.ref })
      } catch (e) {
        console.error('[agent-withdrawal] paid notification failed', e instanceof Error ? e.message : e)
      }
      return NextResponse.json({ ok: true, status: 'Approved', bankTransferStatus: 'manual' })
    }

    if (!record.accountNumber || !record.bankCode) {
      return NextResponse.json({ error: 'Bank account details missing on this withdrawal record' }, { status: 400 })
    }

    // Claim Pending -> Processing BEFORE any Paystack call. A concurrent/second approve claims
    // nothing (count 0) and never reaches Paystack. Reverted to Pending below if the transfer
    // is not started, so the admin can retry (Paystack also dedupes on the record's ref).
    const claim = await prisma.agentWithdrawal.updateMany({
      where: { id, status: 'Pending' },
      data: { status: 'Processing', decidedAt: new Date(), decidedBy, adminNote: adminNote || null },
    })
    if (claim.count === 0) return NextResponse.json({ error: 'Already processed' }, { status: 409 })
    const releaseClaim = () =>
      prisma.agentWithdrawal.updateMany({
        where: { id, status: 'Processing', paystackTransferCode: null },
        data: { status: 'Pending', decidedAt: null, decidedBy: null },
      })

    let recipientName = record.accountName ?? ''
    if (!recipientName) {
      try {
        const r = await resolveAccount(record.accountNumber, record.bankCode)
        recipientName = r.accountName
      } catch {
        recipientName = agent.name
      }
      await prisma.agentWithdrawal.updateMany({ where: { id, status: 'Processing' }, data: { accountName: recipientName } })
    }

    let paystackRecipientCode: string | null = null
    let paystackTransferCode: string | null = null
    let bankTransferStatus: string | null = null
    let transferRequested = false
    let transferStarted = false

    try {
      paystackRecipientCode = await createRecipient(
        recipientName,
        record.accountNumber,
        record.bankCode,
      )
      transferRequested = true
      const transfer = await initiateTransfer(
        record.amount,
        paystackRecipientCode,
        `Vochus Easy Save commission payout — ${agent.name} (${record.ref})`,
        record.ref,
      )
      paystackTransferCode = transfer.transferCode
      bankTransferStatus = transfer.status
      transferStarted = !NO_MONEY_LEFT.includes(transfer.status)

      if (transfer.status === 'otp') {
        await prisma.agentWithdrawal.updateMany({
          where: { id, status: 'Processing' },
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

      if (!transferStarted) {
        await releaseClaim()
        return NextResponse.json({
          error: `Paystack transfer ${transfer.status}. Reason: ${(transfer as any).raw?.gateway_response ?? 'unknown'}. Check your Paystack balance and try again.`,
        }, { status: 502 })
      }
    } catch (err) {
      // Release only when no transfer can exist: Paystack was never asked, or definitely said no. A timeout may still
      // have gone through, so releasing then would allow a second transfer. It stays Processing for Check status.
      const noTransfer = !transferRequested || (!transferStarted && err instanceof PaystackRejected)
      if (!noTransfer) {
        console.error('agent-withdrawal approve: transfer outcome unknown, left Processing', id, err instanceof Error ? err.name : 'unknown')
        return NextResponse.json({ error: 'We couldn’t confirm this transfer with Paystack, and it may still go through. Don’t approve it again. Use Check status with Paystack.' }, { status: 502 })
      }
      await releaseClaim()
      return NextResponse.json({ error: `Paystack transfer failed: ${err instanceof Error ? err.message : 'unknown error'}` }, { status: 502 })
    }

    // 'success' = money moved; 'pending' = queued on Paystack side, verify later
    const finalStatus = bankTransferStatus === 'success' ? 'Approved' : 'Processing'

    await prisma.agentWithdrawal.updateMany({
      where: { id, status: 'Processing' },
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
