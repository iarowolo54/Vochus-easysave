import type { PrismaClient } from '@prisma/client'
import { normalizePhone } from '@/lib/phone'
import { normalizeEmail } from '@/lib/email'

export type IdentityConflict = 'phone' | 'email' | null

/**
 * Checks whether a phone or email is already used by ANY account
 * (Customer, Agent, SubAgent, SuperAdmin, StaffUser). Both sides are
 * normalised in JS so stored legacy formats (raw-cased email, +234 phones)
 * still match. Phone is checked first. Blank/null inputs never match.
 * `excludeCustomerId` omits one Customer row (for edit flows).
 */
export async function findIdentityConflict(
  client: PrismaClient,
  input: { phone?: string | null; email?: string | null },
  opts: { excludeCustomerId?: string; excludeAgentId?: string } = {},
): Promise<IdentityConflict> {
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : ''
  const email = input.email?.trim() ? normalizeEmail(input.email) : ''
  const skipId = opts.excludeCustomerId
  const skipAgentId = opts.excludeAgentId

  if (phone) {
    const [customers, agents, subAgents] = await Promise.all([
      client.customer.findMany({ select: { id: true, phone: true } }),
      client.agent.findMany({ select: { id: true, phone: true } }),
      client.subAgent.findMany({ select: { phone: true } }),
    ])
    const hit =
      customers.some((c) => c.id !== skipId && normalizePhone(c.phone) === phone) ||
      agents.some((a) => a.id !== skipAgentId && normalizePhone(a.phone) === phone) ||
      subAgents.some((s) => normalizePhone(s.phone) === phone)
    if (hit) return 'phone'
  }

  if (email) {
    const [customers, agents, admins, staff] = await Promise.all([
      client.customer.findMany({ where: { email: { not: null } }, select: { id: true, email: true } }),
      client.agent.findMany({ where: { email: { not: null } }, select: { id: true, email: true } }),
      client.superAdmin.findMany({ select: { email: true } }),
      client.staffUser.findMany({ select: { email: true } }),
    ])
    const matches = (e: string | null) => !!e && normalizeEmail(e) === email
    const hit =
      customers.some((c) => c.id !== skipId && matches(c.email)) ||
      agents.some((a) => a.id !== skipAgentId && matches(a.email)) ||
      admins.some((s) => matches(s.email)) ||
      staff.some((s) => matches(s.email))
    if (hit) return 'email'
  }

  return null
}
