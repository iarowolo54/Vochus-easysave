import type { CommissionRates } from '@/lib/commission-rates'
import { redemptionFee } from '@/lib/commission-ledger'

export const CASH_DAILY_RATE = 1 / 31
export const CASH_WEEKLY_RATE = 0.075
export const BANK_DAILY_RATE = 0.025
export const BANK_WEEKLY_RATE = 0.035
export const TOTAL_SAVINGS_FEE = CASH_DAILY_RATE
export const PLATFORM_SAVINGS_FEE = TOTAL_SAVINGS_FEE * (2 / 5)
export const AGENT_SAVINGS_COMMISSION = TOTAL_SAVINGS_FEE * (3 / 5)
export const EARLY_EXIT_PENALTY = 0

export function savingsFeeRates(cadence: string | null | undefined, hasCashDeposit: boolean) {
  const weekly = cadence === 'weekly'
  const total = hasCashDeposit
    ? (weekly ? CASH_WEEKLY_RATE : CASH_DAILY_RATE)
    : (weekly ? BANK_WEEKLY_RATE : BANK_DAILY_RATE)
  return {
    total,
    platform: total * (2 / 5),
    agent: total * (3 / 5),
  }
}

export function redemptionDeduction(opts: {
  balance: number
  dailyAmount: number
  cadence: string | null | undefined
  hasCashDeposit: boolean
  periodDays?: number
  initiator?: 'admin' | 'customer'
  commRates?: CommissionRates
  source?: string | null
  /** New model: the fee is this percent of the balance, all of it the platform's. */
  platformSavingsPct?: number
}) {
  const { balance, dailyAmount, cadence, hasCashDeposit, periodDays, initiator, commRates, source, platformSavingsPct } = opts

  if (source === 'self') {
    return { total: 0, platform: 0, agent: 0 }
  }

  if (platformSavingsPct !== undefined) {
    const fee = redemptionFee(balance, platformSavingsPct, source ?? null)
    return { total: fee, platform: fee, agent: 0 }
  }

  if (commRates) {
    const agentFrac = commRates.agentSavings / 100
    const platformFrac = commRates.platformSavings / 100
    const total = balance * (agentFrac + platformFrac)
    return {
      total,
      platform: balance * platformFrac,
      agent: balance * agentFrac,
    }
  }

  if (initiator === 'admin' && periodDays) {
    const isDaily = !cadence || cadence === 'daily'
    const d = isDaily
      ? Math.min(Math.round(dailyAmount * (periodDays / 31) * 100) / 100, balance)
      : Math.min(Math.round(balance * 0.20 * 100) / 100, balance)
    return { total: d, platform: d * (2 / 5), agent: d * (3 / 5) }
  }
  const rates = savingsFeeRates(cadence, hasCashDeposit)
  return {
    total: balance * rates.total,
    platform: balance * rates.platform,
    agent: balance * rates.agent,
  }
}

export async function planHasCashDeposit(prisma: any, planId: string): Promise<boolean> {
  const anyCash = await prisma.transaction.findFirst({
    where: {
      planId,
      type: 'saving',
      NOT: { method: 'Paystack' },
    },
    select: { id: true },
  })
  return !!anyCash
}
