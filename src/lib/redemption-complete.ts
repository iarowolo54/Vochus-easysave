// Shared completion ledger for an admin-approved early redemption. Extracted verbatim from
// api/admin/early-redemption/[id]/route.ts so every approve path produces the same ledger effect.
// Must run inside a prisma.$transaction callback; throws ConflictError when a guard claims nothing.
import type { Prisma } from '@prisma/client'
import { money } from '@/lib/wallet-guard'
import { interestPayoutOps } from '@/lib/redemption-interest-ops'

export class ConflictError extends Error {}

export interface RedemptionRecord {
  id: string
  ref: string
  savingsPlanId: string
  penalty: number
  netPayout: number
  payoutMethod: string | null
  interestAmount: number
}

export interface RedemptionCompletionOpts {
  decidedBy: string
  isBankTransfer: boolean
  bankTransferStatus: string | null
  paystackRecipientCode: string | null
  paystackTransferCode: string | null
  /** 'Processing' (bank transfer already pre-claimed, plan already locked) or the open statuses. */
  claimFrom: 'Processing' | string[]
  walletAfter: number
}

export async function redemptionCompletionOps(
  tx: Prisma.TransactionClient,
  record: RedemptionRecord,
  agentId: string,
  customerId: string | null,
  opts: RedemptionCompletionOpts,
): Promise<void> {
  const { decidedBy, isBankTransfer, bankTransferStatus, paystackRecipientCode, paystackTransferCode, claimFrom, walletAfter } = opts
  const agentComm = money(record.penalty * (3 / 5))
  const platformFee = money(record.penalty * (2 / 5))
  const revenueCredit = platformFee

  // Bank: the Processing claim (and plan lock) was taken earlier. Cash: claim record + plan here.
  const claim = await tx.earlyRedemption.updateMany({
    where: { id: record.id, status: typeof claimFrom === 'string' ? claimFrom : { in: claimFrom } },
    data: {
      status: 'Approved',
      decidedAt: new Date(),
      decidedBy,
      ...(isBankTransfer && { paystackRecipientCode, paystackTransferCode, bankTransferStatus }),
    },
  })
  if (claim.count === 0) throw new ConflictError()
  if (!isBankTransfer) {
    const plan = await tx.savingsPlan.updateMany({
      where: { id: record.savingsPlanId, status: { not: 'Redeemed' }, balance: { gt: 0 } },
      data: { status: 'Redeemed', balance: 0 },
    })
    if (plan.count === 0) throw new ConflictError('This plan has already been redeemed')
  }
  await tx.platformWallet.upsert({
    where: { type: 'Revenue' },
    update: { balance: { increment: revenueCredit } },
    create: { type: 'Revenue', balance: revenueCredit },
  })
  await tx.agent.update({
    where: { id: agentId },
    data: {
      commissionBalance: { increment: agentComm },
      // For cash payout the agent physically pays out; credit their wallet back with netPayout.
      // For bank transfer Paystack pays directly so no wallet credit.
      ...(isBankTransfer ? {} : { walletBalance: { increment: record.netPayout } }),
    },
  })
  await tx.transaction.create({
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
  })
  for (const op of interestPayoutOps(tx, record, agentId, customerId)) await op
}
