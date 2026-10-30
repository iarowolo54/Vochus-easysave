// Shared, DB-free definition of customer type and last-paid time so the agent
// and admin customer lists cannot drift.

export type CustomerType = 'online' | 'offline'

/** 'online' if any plan was self-created by the customer, else 'offline'. */
export function customerType(plans: { source: string }[]): CustomerType {
  return plans.some((p) => p.source === 'self') ? 'online' : 'offline'
}

/** ISO string of the latest deposit createdAt, or null when there are none. */
export function lastPaidAtOf(deposits: { createdAt: Date }[]): string | null {
  if (deposits.length === 0) return null
  let max = deposits[0].createdAt.getTime()
  for (const d of deposits) max = Math.max(max, d.createdAt.getTime())
  return new Date(max).toISOString()
}
