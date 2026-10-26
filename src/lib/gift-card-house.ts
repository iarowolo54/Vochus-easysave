import { prisma } from './prisma'
import bcrypt from 'bcryptjs'

const HOUSE_AGENT_CODE = 'AGT-HOUSE'

export async function getHouseAgentId(): Promise<string> {
  const existing = await prisma.agent.findUnique({ where: { agentId: HOUSE_AGENT_CODE } })
  if (existing) return existing.id
  const created = await prisma.agent.create({
    data: {
      agentId: HOUSE_AGENT_CODE,
      name: 'Vochus House',
      phone: '+000-HOUSE',
      email: 'house@vochus.internal',
      location: 'Vochus HQ',
      password: await bcrypt.hash(Math.random().toString(36), 10),
      status: 'System',
      emailVerified: true,
    },
  })
  return created.id
}
