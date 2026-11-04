export type DayEntry = { amount: number; ref: string; time: string }
type Tx = { planId: string | null; amount: number; ref: string; createdAt: Date }

/**
 * Group a month's savings into one day map per plan, so each plan gets its own calendar.
 * `plans` must be newest first. A saving that isn't on any of these plans (an older closed plan,
 * or one with no plan recorded) goes to the newest plan, as the single-plan calendar always did.
 */
export function splitDaysByPlan(plans: { id: string }[], txs: Tx[]): Record<string, Record<number, DayEntry>> {
  const out: Record<string, Record<number, DayEntry>> = {}
  for (const p of plans) out[p.id] = {}
  if (plans.length === 0) return out
  const known = new Set(plans.map(p => p.id))
  for (const tx of txs) {
    const owner = tx.planId && known.has(tx.planId) ? tx.planId : plans[0].id
    const d = tx.createdAt.getDate()
    const days = out[owner]
    if (!days[d]) {
      days[d] = { amount: 0, ref: tx.ref, time: tx.createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }
    }
    days[d].amount += tx.amount
  }
  return out
}
