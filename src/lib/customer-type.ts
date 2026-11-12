// Shared, DB-free definition of customer type and last-paid time so the agent
// and admin customer lists cannot drift.

export type CustomerType = 'online' | 'offline'

/**
 * The stored `Customer.type`, narrowed. Online = registered themselves; offline = registered by an agent.
 * Anything unexpected reads as offline, the side that can't open plans in the app.
 */
export function asCustomerType(v: unknown): CustomerType {
  return v === 'online' ? 'online' : 'offline'
}

/** The plan `source` a plan for this customer must carry, so the money rules (which read `source`) follow the customer. */
export function planSourceFor(t: CustomerType): 'self' | 'agent' {
  return t === 'online' ? 'self' : 'agent'
}

const BLOCK_CUSTOMER = 'Your plans are set up by your agent. Please ask them to open a new plan for you.'
const BLOCK_AGENT = 'This customer saves on the app. They open their own plans.'

/** Why this actor can't open a plan for this customer, or null when they can. Offline: agent only. Online: customer only. */
export function planCreationBlock(by: 'customer' | 'agent', t: CustomerType): string | null {
  if (by === 'customer' && t === 'offline') return BLOCK_CUSTOMER
  if (by === 'agent' && t === 'online') return BLOCK_AGENT
  return null
}

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
