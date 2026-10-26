import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

type CustomerRef = {
  id: string
  agentId: string
  firstName: string
  lastName: string
  customerId: string
  createdAt: Date
}

export async function creditRegistrationReward(customer: CustomerRef) {
  const promo = await prisma.rewardPromo.findFirst({
    where: {
      isActive: true,
      startDate: { lte: customer.createdAt },
      endDate: { gte: customer.createdAt },
    },
  })
  if (!promo) return

  const existing = await prisma.agentReward.findUnique({ where: { customerId: customer.id } })
  if (existing) return

  const invite = await prisma.customerInvite.findFirst({ where: { customerId: customer.id } })
  const type = invite ? 'online' : 'offline'
  const amount = type === 'online' ? promo.onlineRewardAmount : promo.offlineRewardAmount

  await prisma.$transaction([
    prisma.agentReward.create({
      data: {
        agentId: customer.agentId,
        customerId: customer.id,
        promoId: promo.id,
        type,
        amount,
        narration: 'Reward fee',
      },
    }),
    prisma.agent.update({
      where: { id: customer.agentId },
      data: { commissionBalance: { increment: amount } },
    }),
  ])

  logAudit({
    action: 'agent_registration_reward',
    entity: 'AgentReward',
    details: `Agent earned ₦${amount} registration reward for ${type} customer ${customer.firstName} ${customer.lastName} (${customer.customerId})`,
    actorType: 'system',
    actorName: 'Reward System',
    actorId: customer.agentId,
  })
}
