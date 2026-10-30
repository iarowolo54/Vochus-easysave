// Interest paid out on a self-source early redemption: the frozen interestAmount is funded by the
// platform (Revenue wallet debit) and recorded as its own ledger row. netPayout already includes it.
import type { Prisma, PrismaClient } from '@prisma/client'

type Client = Pick<PrismaClient, 'platformWallet' | 'transaction'> | Prisma.TransactionClient

export function interestPayoutOps(
  client: Client,
  record: { ref: string; interestAmount: number; savingsPlanId: string },
  agentId: string,
  customerId: string | null,
) {
  if (!(record.interestAmount > 0)) return []
  return [
    client.platformWallet.upsert({
      where: { type: 'Revenue' },
      update: { balance: { decrement: record.interestAmount } },
      create: { type: 'Revenue', balance: -record.interestAmount },
    }),
    client.transaction.create({
      data: {
        ref: `${record.ref}-INT`,
        agentId,
        customerId,
        planId: record.savingsPlanId,
        type: 'interest',
        amount: record.interestAmount,
        method: 'Cash',
        status: 'Done',
      },
    }),
  ]
}
