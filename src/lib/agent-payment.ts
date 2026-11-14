// An agent paying into an ONLINE customer's plan (from the agent's wallet) is allowed, but it must always read as the
// agent's payment: the transaction carries `paidByAgentId`, the audit log gets its own entry, and the customer sees who
// paid it in. Offline (cash saver) deposits are the agent's by nature and keep their usual records.
import { displayName, formatNaira } from '@/lib/format'

export const AGENT_PAID_ACTION = 'agent_paid_for_online_customer'

const naira = (n: number) => formatNaira(n, Number.isInteger(n) ? { minor: false } : {})

export function agentPaidAuditDetails(f: {
  agentName: string; agentCode: string; amount: number; customerName: string; planGoal: string; ref: string; days?: number
}): string {
  const span = f.days && f.days > 1 ? ` for ${f.days} days` : ''
  return `Agent ${displayName(f.agentName)} (${f.agentCode}) paid ${naira(f.amount)} from the agent wallet into online customer ${displayName(f.customerName)}’s plan “${f.planGoal}”${span} (${f.ref})`
}

/** What the customer reads on the receipt, history and notification. */
export function paidByLine(agentName: string): string {
  return `Paid in by your agent, ${displayName(agentName)}`
}
