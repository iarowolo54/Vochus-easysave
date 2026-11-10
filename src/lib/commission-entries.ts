import { prisma } from '@/lib/prisma'
import {
  loanCommission,
  repaymentCommission,
  redemptionCommission,
  entriesFromLedger,
  mergeHistory,
  type CommissionEntry,
  type CommissionSource,
} from '@/lib/commission-history'

const custName = (c: { firstName: string; lastName: string } | null | undefined) =>
  c ? `${c.firstName} ${c.lastName}`.trim() : null

/** Everything an agent has earned, event by event. The one source for the admin history drawer and the agent's Commission page. */
export async function loadCommissionEntries(
  agentId: string,
  opts: { from?: Date; to?: Date; want?: (s: CommissionSource) => boolean } = {},
): Promise<CommissionEntry[]> {
  const { from: fromDate, to: toDate, want = () => true } = opts
  const createdRange = fromDate || toDate ? { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } : undefined

  const ledgerRows = await prisma.commissionLedger.findMany({
    where: { party: 'agent', agentId: agentId, ...(createdRange && { createdAt: createdRange }) },
    orderBy: { createdAt: 'desc' },
  })
  const ledgerCustomerIds = [...new Set(ledgerRows.map(r => r.customerId).filter((c): c is string => !!c))]
  const ledgerCustomers = ledgerCustomerIds.length
    ? await prisma.customer.findMany({ where: { id: { in: ledgerCustomerIds } }, select: { id: true, firstName: true, lastName: true, customerId: true } })
    : []
  const ledgerEntries = entriesFromLedger(
    ledgerRows,
    new Map(ledgerCustomers.map(c => [c.id, { name: `${c.firstName} ${c.lastName}`.trim(), customerId: c.customerId }])),
  ).filter(e => want(e.source))

  const [disbursements, repayments, redemptions, rewards] = await Promise.all([
    want('loan')
      ? prisma.transaction.findMany({
          where: { agentId: agentId, type: 'disbursement', ...(createdRange && { createdAt: createdRange }) },
          select: { id: true, ref: true, amount: true, status: true, createdAt: true, customerId: true, customer: { select: { firstName: true, lastName: true, customerId: true } } },
        })
      : Promise.resolve([]),
    want('repayment')
      ? prisma.transaction.findMany({
          where: { agentId: agentId, type: 'repayment', ...(createdRange && { createdAt: createdRange }) },
          select: { id: true, ref: true, amount: true, status: true, createdAt: true, customerId: true, customer: { select: { firstName: true, lastName: true, customerId: true } } },
        })
      : Promise.resolve([]),
    want('redemption')
      ? prisma.earlyRedemption.findMany({
          where: {
            status: 'Approved',
            feeRule: 'v1', // v2 redemptions are in the ledger; their fee is not split 3/5
            penalty: { gt: 0 },
            savingsPlan: { customer: { agentId: agentId } },
            ...(createdRange && { decidedAt: createdRange }),
          },
          select: { id: true, ref: true, penalty: true, status: true, decidedAt: true, requestedAt: true, savingsPlan: { select: { goal: true, customer: { select: { firstName: true, lastName: true, customerId: true } } } } },
        })
      : Promise.resolve([]),
    want('reward')
      ? prisma.agentReward.findMany({
          where: { agentId: agentId, ...(createdRange && { createdAt: createdRange }) },
          select: { id: true, amount: true, type: true, narration: true, createdAt: true, customer: { select: { firstName: true, lastName: true, customerId: true } } },
        })
      : Promise.resolve([]),
  ])

  const reconstructed: CommissionEntry[] = [
    ...disbursements.map((t): CommissionEntry => ({
      id: `loan:${t.id}`, date: t.createdAt.toISOString(), source: 'loan',
      commission: loanCommission(t.amount), baseAmount: t.amount,
      customerId: t.customer?.customerId ?? null, customerName: custName(t.customer), planGoal: null, ref: t.ref, status: t.status,
    })),
    ...repayments.map((t): CommissionEntry => ({
      id: `repayment:${t.id}`, date: t.createdAt.toISOString(), source: 'repayment',
      commission: repaymentCommission(t.amount), baseAmount: t.amount,
      customerId: t.customer?.customerId ?? null, customerName: custName(t.customer), planGoal: null, ref: t.ref, status: t.status,
    })),
    ...redemptions.map((r): CommissionEntry => ({
      id: `redemption:${r.id}`, date: (r.decidedAt ?? r.requestedAt).toISOString(), source: 'redemption',
      commission: redemptionCommission(r.penalty), baseAmount: r.penalty,
      customerId: r.savingsPlan.customer?.customerId ?? null, customerName: custName(r.savingsPlan.customer), planGoal: r.savingsPlan.goal, ref: r.ref, status: r.status,
    })),
    ...rewards.map((a): CommissionEntry => ({
      id: `reward:${a.id}`, date: a.createdAt.toISOString(), source: 'reward',
      commission: a.amount, baseAmount: a.amount,
      customerId: a.customer?.customerId ?? null, customerName: custName(a.customer), planGoal: null, ref: a.narration || a.type, status: 'Done',
    })),
  ]

  // Ledger rows are exact; reconstructed events they cover are dropped. Source + date filtering is already applied.
  return mergeHistory(ledgerEntries, reconstructed)
}
