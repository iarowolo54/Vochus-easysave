// Flexible savings: any amount, any day, between a start and an end date chosen by the customer, held for at least
// a minimum term. No fee on deposits; what Vochus and the agent earn is taken once, when the money is collected:
//   cash (agent) plans — a commission, plus a penalty if collected before the end date;
//   online (self) plans — only the penalty, and only if collected before the end date.
// Settings live in one PlatformSetting row (key 'flexibleSavings', JSON), edited by super admin.
// Kept free of server-only imports (Prisma is a type import) so screens can use the pure parts.
import type { PrismaClient } from '@prisma/client'
import { money } from '@/lib/money'
import { pct } from '@/lib/commission-rates'
import { resolvePlanStartDate } from '@/lib/saving-plan'
import { daysBetween, MAX_PLAN_DAYS } from '@/lib/plan-dates'

export const FLEXIBLE = 'flexible'
export const PLAN_CADENCES = ['daily', 'weekly', 'monthly', 'flexible'] as const
export type PlanCadence = (typeof PLAN_CADENCES)[number]

export function isFlexible(cadence: string | null | undefined): boolean {
  return cadence === FLEXIBLE
}

/** A cadence from a request body. Blank means daily (what every route did before); an unknown value is refused (null). */
export function parseCadence(v: unknown): PlanCadence | null {
  if (v === undefined || v === null || v === '') return 'daily'
  return typeof v === 'string' && (PLAN_CADENCES as readonly string[]).includes(v) ? (v as PlanCadence) : null
}

export interface FlexibleSettings {
  /** Shortest allowed plan, in calendar months. */
  minTermMonths: number
  /** Smallest single deposit, in naira. */
  minDeposit: number
  /** Cash plans: percent of the balance taken when they collect. */
  cashCommissionPct: number
  /** The agent's percent of that commission. */
  cashCommissionAgentPct: number
  /** Percent of the balance taken when a plan is collected before its end date (cash and online). */
  penaltyPct: number
  /** The agent's percent of that penalty. */
  penaltyAgentPct: number
}

export const DEFAULT_FLEXIBLE_SETTINGS: FlexibleSettings = {
  minTermMonths: 3, minDeposit: 100, cashCommissionPct: 5, cashCommissionAgentPct: 60, penaltyPct: 5, penaltyAgentPct: 40,
}

export const FLEXIBLE_SETTING_KEY = 'flexibleSavings'

type Field = keyof FlexibleSettings
const FIELDS = Object.keys(DEFAULT_FLEXIBLE_SETTINGS) as Field[]
const LABEL: Record<Field, string> = {
  minTermMonths: 'Shortest plan', minDeposit: 'Smallest deposit', cashCommissionPct: 'Commission',
  cashCommissionAgentPct: 'Agent’s share of the commission', penaltyPct: 'Penalty for stopping early',
  penaltyAgentPct: 'Agent’s share of the penalty',
}
const RANGE: Record<Field, [number, number]> = {
  minTermMonths: [1, 60], minDeposit: [0, 1_000_000], cashCommissionPct: [0, 25],
  cashCommissionAgentPct: [0, 100], penaltyPct: [0, 25], penaltyAgentPct: [0, 100],
}

function usable(k: Field, v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false
  if (k === 'minTermMonths' && !Number.isInteger(v)) return false
  return v >= RANGE[k][0] && v <= RANGE[k][1]
}

/** Field by field: a usable value is kept, anything else takes that field's default. Never throws. */
export function parseFlexibleSettings(raw: unknown): FlexibleSettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out = { ...DEFAULT_FLEXIBLE_SETTINGS }
  for (const k of FIELDS) if (usable(k, src[k])) out[k] = src[k] as number
  return out
}

/** For a super admin save: every field must be present and in range. Extra keys are dropped. */
export function validateFlexibleSettings(raw: unknown): { ok: true; settings: FlexibleSettings } | { ok: false; error: string } {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!src) return { ok: false, error: 'Invalid payload' }
  const out = { ...DEFAULT_FLEXIBLE_SETTINGS }
  for (const k of FIELDS) {
    if (!usable(k, src[k])) {
      const [lo, hi] = RANGE[k]
      return { ok: false, error: `${LABEL[k]} must be ${k === 'minTermMonths' ? 'a whole number ' : ''}from ${lo} to ${hi.toLocaleString('en-NG')}.` }
    }
    out[k] = src[k] as number
  }
  return { ok: true, settings: out }
}

export async function getFlexibleSettings(client: Pick<PrismaClient, 'platformSetting'>): Promise<FlexibleSettings> {
  try {
    const s = await client.platformSetting.findUnique({ where: { key: FLEXIBLE_SETTING_KEY } })
    return parseFlexibleSettings(s ? JSON.parse(s.value) : null)
  } catch {
    return { ...DEFAULT_FLEXIBLE_SETTINGS }
  }
}

/** date + k calendar months in local time (plans store local midnight), the day clamped to the target month's last day. */
export function addMonthsLocal(date: Date, k: number): Date {
  const y = date.getFullYear()
  const m = date.getMonth() + k
  const lastDay = new Date(y, m + 1, 0).getDate()
  return new Date(y, m, Math.min(date.getDate(), lastDay), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds())
}

/** The earliest end date allowed for a plan starting on `start`. */
export function earliestEnd(start: Date, s: Pick<FlexibleSettings, 'minTermMonths'>): Date {
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  return addMonthsLocal(d, s.minTermMonths)
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/
function realLocalDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null
  const m = YMD.exec(v)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Works out a new flexible plan's dates from what the person chose. The server's word: never trust the screen's check. */
export function resolveFlexiblePlan(
  input: { startDate: unknown; endDate: unknown },
  s: FlexibleSettings,
  now: Date = new Date(),
): { startDate: Date; maturityDate: Date; periodDays: number } | { error: string } {
  const start = resolvePlanStartDate(input.startDate, now)
  if ('error' in start) return start
  if (input.endDate === undefined || input.endDate === null || input.endDate === '') return { error: 'Choose an end date.' }
  const end = realLocalDate(input.endDate)
  if (!end) return { error: 'The end date is not a real date.' }
  const earliest = earliestEnd(start.date, s)
  if (end.getTime() < earliest.getTime()) {
    return { error: `A flexible plan must run at least ${s.minTermMonths} months. Choose an end date on or after ${shortDate(earliest)}.` }
  }
  const periodDays = daysBetween(start.date, end)
  if (periodDays > MAX_PLAN_DAYS) return { error: 'That end date is too far away.' }
  return { startDate: start.date, maturityDate: end, periodDays }
}

/** Early = before the local calendar day the plan ends on. Collecting at any time on the end date is not early. */
export function isEarlyCollection(maturityDate: Date, at: Date): boolean {
  const endDay = new Date(maturityDate.getFullYear(), maturityDate.getMonth(), maturityDate.getDate())
  return at.getTime() < endDay.getTime()
}

export interface FlexibleDeduction { commission: number; penalty: number; deduction: number; feeAgent: number; early: boolean }

/** What comes off a flexible plan when it is collected, and the agent's part of it. The rest is the platform's. */
export function flexibleDeduction(
  i: { source: string | null; balance: number; maturityDate: Date; at: Date },
  s: FlexibleSettings,
): FlexibleDeduction {
  const balance = Math.max(0, money(i.balance))
  const early = isEarlyCollection(i.maturityDate, i.at)
  const commission = i.source === 'self' ? 0 : pct(balance, s.cashCommissionPct)
  const penalty = early ? pct(balance, s.penaltyPct) : 0
  const gross = money(commission + penalty)
  const deduction = money(Math.min(balance, gross))
  let feeAgent = money(pct(commission, s.cashCommissionAgentPct) + pct(penalty, s.penaltyAgentPct))
  if (gross > 0 && deduction < gross) feeAgent = money((feeAgent * deduction) / gross)
  feeAgent = Math.min(feeAgent, deduction)
  return { commission, penalty, deduction, feeAgent, early }
}

export type FlexiblePlanData = { cadence: typeof FLEXIBLE; dailyAmount: 0; periodDays: number; startDate: Date; maturityDate: Date }

/** The SavingsPlan fields for a new flexible plan. Any amount or length the client sent is ignored. */
export function flexiblePlanData(input: { startDate: unknown; endDate: unknown }, s: FlexibleSettings, now: Date = new Date()): FlexiblePlanData | { error: string } {
  const r = resolveFlexiblePlan(input, s, now)
  if ('error' in r) return r
  return { cadence: FLEXIBLE, dailyAmount: 0, periodDays: r.periodDays, startDate: r.startDate, maturityDate: r.maturityDate }
}

export const BAD_CADENCE = 'Choose daily, weekly, monthly or flexible.'
