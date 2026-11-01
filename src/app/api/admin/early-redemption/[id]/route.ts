import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { verifyApprovalPin } from '@/lib/approval-pin'
import { createRecipient, initiateTransfer } from '@/lib/paystack'
import { logAudit } from '@/lib/audit'
import { redemptionCompletionOps, ConflictError } from '@/lib/redemption-complete'
import { getPayoutMode } from '@/lib/payout-mode'
import { customerType } from '@/lib/customer-type'
import {
  notifyCustomerRedemptionPaid,
  notifyCustomerRedemptionDeclined,
  notifyAgentRedemptionPaid,
  notifyAgentRedemptionDeclined,
} from '@/lib/payout-notify'

const OPEN_STATUSES = ['Pending', 'TokenValidated', 'AgentApproved']

/**
 * Manual-mode customer/agent notifications for a decided redemption. Best-effort: loads the
 * contacts itself and swallows every error so it can never fail an already-committed decision.
 */
async function notifyManualOutcome(
  outcome: { kind: 'paid' } | { kind: 'declined'; reason: string },
  r: { ref: string; netPayout: number },
  customerId: string,
  agentId: string,
): Promise<void> {
  try {
    const [customer, agent, plans] = await Promise.all([
      prisma.customer.findUnique({ where: { id: customerId }, select: { firstName: true, lastName: true, email: true, phone: true } }),
      prisma.agent.findUnique({ where: { id: agentId }, select: { email: true, phone: true } }),
      prisma.savingsPlan.findMany({ where: { customerId }, select: { source: true } }),
    ])
    if (!customer) return
    const type = customerType(plans)
    const customerName = `${customer.firstName} ${customer.lastName}`
    const base = { amountNaira: r.netPayout, ref: r.ref }
    if (outcome.kind === 'paid') {
      await notifyCustomerRedemptionPaid(customer, type, base)
      if (agent) await notifyAgentRedemptionPaid(agent, { customerName, ...base })
    } else {
      await notifyCustomerRedemptionDeclined(customer, type, { ...base, reason: outcome.reason })
      if (agent) await notifyAgentRedemptionDeclined(agent, { customerName, ...base, reason: outcome.reason })
    }
  } catch (err) {
    console.error('[early-redemption] manual notify failed:', err instanceof Error ? err.message : 'unknown error')
  }
}

const conflict = (error = 'Already processed') => NextResponse.json({ error }, { status: 409 })

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return guard.response
  const session = guard.session

  const { id } = await context.params
  const body = await req.json()
  const { action, pin } = body

  if (action === 'approve') {
    if (!pin) return NextResponse.json({ error: 'Approval PIN required' }, { status: 400 })
    const pinCheck = await verifyApprovalPin(session, pin)
    if (!pinCheck.ok) return pinCheck.response
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
  if (!OPEN_STATUSES.includes(record.status)) return conflict('Already decided')

  const adminUser = session.user as { name?: string }
  const decidedBy = adminUser.name ?? 'Super Admin'

  if (action === 'reject') {
    const customerName = `${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName}`
    const planBalance = record.savingsPlan.balance
    const agentForBal = await prisma.agent.findUnique({
      where: { id: record.savingsPlan.customer.agentId },
      select: { walletBalance: true, name: true },
    })

    try {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.earlyRedemption.updateMany({
          where: { id, status: { in: OPEN_STATUSES } },
          data: { status: 'Rejected', decidedAt: new Date(), decidedBy },
        })
        if (claim.count === 0) throw new ConflictError()
        await tx.savingsPlan.update({
          where: { id: record.savingsPlanId },
          data: { status: 'Active' },
        })
      })
    } catch (err) {
      if (err instanceof ConflictError) return conflict('Already decided')
      throw err
    }

    logAudit({
      action: 'early_redemption_rejected',
      entity: 'EarlyRedemption',
      entityId: id,
      details: `Admin rejected ${record.ref} — customer ${customerName} balance ₦${planBalance.toLocaleString()} restored to Active | agent wallet ₦${(agentForBal?.walletBalance ?? 0).toLocaleString()}`,
      actorType: 'admin',
      actorId: (session.user as any).id,
      actorName: decidedBy,
    })

    // Manual mode: tell the customer + agent. Mode read and notify are isolated — the reject is committed.
    try {
      if ((await getPayoutMode()).customer === 'manual') {
        const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 200) : 'declined by admin'
        await notifyManualOutcome({ kind: 'declined', reason }, record, record.savingsPlan.customer.id, record.savingsPlan.customer.agentId)
      }
    } catch {
      /* best-effort */
    }
    return NextResponse.json({ ok: true, status: 'Rejected' })
  }

  if (action === 'approve') {
    // Mutual exclusion with the agent redemption path: never pay out a plan that
    // has already been redeemed (defence alongside loadOwnedRedeemablePlan).
    if (record.savingsPlan.status === 'Redeemed' || record.savingsPlan.balance <= 0) {
      return NextResponse.json({ error: 'This plan has already been redeemed' }, { status: 409 })
    }
    // Manual mode changes only the payout rail: no Paystack, same ledger. A throw here => 500 (fail closed).
    const agentId = record.savingsPlan.customer.agentId
    const customerId = record.savingsPlan.customer.id
    const isBankTransfer = record.payoutMethod === 'Bank Transfer' || record.payoutMethod === 'BankTransfer'
    // Manual applies to bank transfers only; Cash never reads the mode. A throw here => 500 (fail closed).
    const manualBank = isBankTransfer && (await getPayoutMode()).customer === 'manual'
    const originalStatus = record.status
    const originalPlanStatus = record.savingsPlan.status
    const originalPlanBalance = record.savingsPlan.balance

    let paystackRecipientCode: string | null = null
    let paystackTransferCode: string | null = null
    let bankTransferStatus: string | null = null

    if (isBankTransfer && !manualBank) {
      if (!record.accountNumber || !record.bankCode || !record.accountName) {
        return NextResponse.json({ error: 'Bank account details missing on this redemption record' }, { status: 400 })
      }

      // Claim BEFORE Paystack: record OPEN -> Processing and the plan -> Redeemed/0, atomically.
      // A concurrent approve (or the agent redemption path) claims nothing and never reaches Paystack.
      try {
        await prisma.$transaction(async (tx) => {
          const claim = await tx.earlyRedemption.updateMany({
            where: { id, status: { in: OPEN_STATUSES } },
            data: { status: 'Processing' },
          })
          if (claim.count === 0) throw new ConflictError()
          const plan = await tx.savingsPlan.updateMany({
            where: { id: record.savingsPlanId, status: { not: 'Redeemed' }, balance: { gt: 0 } },
            data: { status: 'Redeemed', balance: 0 },
          })
          if (plan.count === 0) throw new ConflictError('This plan has already been redeemed')
        })
      } catch (err) {
        if (err instanceof ConflictError) return conflict(err.message || 'Already processed')
        throw err
      }

      // Undo the claim when no transfer was started, so the admin can retry.
      const releaseClaim = () =>
        prisma.$transaction(async (tx) => {
          const rel = await tx.earlyRedemption.updateMany({
            where: { id, status: 'Processing', paystackTransferCode: null },
            data: { status: originalStatus },
          })
          if (rel.count === 1) {
            await tx.savingsPlan.updateMany({
              where: { id: record.savingsPlanId, status: 'Redeemed', balance: 0 },
              data: { status: originalPlanStatus, balance: originalPlanBalance },
            })
          }
        })

      let transferStarted = false
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

        if (transfer.status === 'failed' || transfer.status === 'reversed') {
          await releaseClaim()
          return NextResponse.json({ error: `Paystack transfer ${transfer.status}. Check your Paystack balance and try again.` }, { status: 502 })
        }
        transferStarted = true

        // Paystack requires OTP finalisation — pause and wait for admin to enter it.
        if (transfer.status === 'otp') {
          await prisma.earlyRedemption.updateMany({
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
            message: 'Paystack has sent an OTP to your transfer-approval phone. Enter it to complete the payout.',
          })
        }
      } catch (err: any) {
        // Once Paystack has accepted a transfer the claim is never released (would allow a 2nd transfer).
        if (!transferStarted) await releaseClaim()
        return NextResponse.json({ error: `Paystack transfer failed: ${err.message}` }, { status: 502 })
      }
    }

    const agentForBalance = await prisma.agent.findUnique({ where: { id: agentId }, select: { walletBalance: true } })
    const walletAfter = isBankTransfer
      ? (agentForBalance?.walletBalance ?? 0)
      : (agentForBalance?.walletBalance ?? 0) + record.netPayout

    try {
      await prisma.$transaction((tx) =>
        redemptionCompletionOps(tx, record, agentId, customerId, {
          decidedBy,
          isBankTransfer,
          // Manual bank transfer: no Paystack pre-claim happened, so claim from OPEN and let the helper lock the plan.
          bankTransferStatus: manualBank ? 'manual' : bankTransferStatus,
          paystackRecipientCode,
          paystackTransferCode,
          claimFrom: manualBank ? OPEN_STATUSES : isBankTransfer ? 'Processing' : OPEN_STATUSES,
          walletAfter,
          // Optional transfer reference, recorded only for a manual payout (admin paid out-of-band).
          adminNote: manualBank && typeof body.adminNote === 'string' && body.adminNote.trim()
            ? body.adminNote.trim().slice(0, 200)
            : undefined,
        }),
      )
    } catch (err) {
      if (err instanceof ConflictError) return conflict(err.message || 'Already processed')
      throw err
    }

    logAudit({
      action: 'early_redemption_approved',
      entity: 'EarlyRedemption',
      entityId: id,
      details: `Admin approved ${record.ref} — payout ₦${record.netPayout.toLocaleString()} via ${record.payoutMethod ?? 'Cash'} | customer ${record.savingsPlan.customer.firstName} ${record.savingsPlan.customer.lastName} balance ₦${record.balance.toLocaleString()} → ₦0 | agent wallet after ₦${walletAfter.toLocaleString()}`,
      actorType: 'admin',
      actorId: (session.user as any).id,
      actorName: decidedBy,
    })
    if (manualBank) {
      await notifyManualOutcome({ kind: 'paid' }, record, customerId, agentId)
    }
    return NextResponse.json({ ok: true, status: 'Approved', bankTransferStatus: manualBank ? 'manual' : bankTransferStatus })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
