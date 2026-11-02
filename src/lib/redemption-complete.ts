// Shared completion ledger for an admin-approved early redemption. Extracted verbatim from
// api/admin/early-redemption/[id]/route.ts so every approve path produces the same ledger effect.
// Must run inside a prisma.$transaction callback; throws ConflictError when a guard claims nothing.
import type { Prisma } from '@prisma/client'
import { money } from '@/lib/wallet-guard'
import { interestPayoutOps } from '@/lib/redemption-interest-ops'
import { claimPlanForPayout } from '@/lib/redemption-balance'

export class ConflictError extends Error {}

export interface RedemptionRecord {
  id: string
  ref: string
  savingsPlanId: string
  balance: number
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
  /** Optional transfer reference for a manual payout; written to the record only when provided. */
  adminNote?: string | null
}

export async function redemptionCompletionOps(
  tx: Prisma.TransactionClient,
  record: RedemptionRecord,
  agentId: string,
  customerId: string | null,
  opts: RedemptionCompletionOpts,
): Promise<void> {
  const { decidedBy, isBankTransfer, bankTransferStatus, paystackRecipientCode, paystackTransferCode, claimFrom, walletAfter, adminNote } = opts
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
      ...(adminNote != null && { adminNote }),
    },
  })
  if (claim.count === 0) throw new ConflictError()
  // Lock the plan unless it was already locked by a Processing pre-claim (auto bank transfer).
  if (claimFrom !== 'Processing') {
    const refused = await claimPlanForPayout(tx, record.savingsPlanId, record.balance)
    if (refused) throw new ConflictError(refused)
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
