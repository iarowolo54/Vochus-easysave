import { prisma } from './prisma'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'

const HOUSE_AGENT_CODE = 'AGT-HOUSE'

export async function getHouseAgentId(): Promise<string> {
  const existing = await prisma.agent.findUnique({ where: { agentId: HOUSE_AGENT_CODE } })
  if (existing) return existing.id
  // Not identity-guarded: synthetic internal placeholders (+000-HOUSE, @vochus.internal) and a random password; no person signs in as this agent.
  const created = await prisma.agent.create({
    data: {
      agentId: HOUSE_AGENT_CODE,
      name: 'Vochus House',
      phone: '+000-HOUSE',
      email: 'house@vochus.internal',
      location: 'Vochus HQ',
      password: await bcrypt.hash(randomBytes(24).toString('hex'), 10),
      status: 'System',
      emailVerified: true,
    },
  })
  return created.id
}
