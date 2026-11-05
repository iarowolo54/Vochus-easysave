// One rule for crediting an agent's wallet from a bank transfer, whether the alert matched on its own or staff
// credited it by hand. The server-side intent decides which agent; the bank only says what arrived.
import type { PaymentIntent, PrismaClient } from '@prisma/client'
import { logAudit } from '@/lib/audit'
import { INTENT_PENDING, consumePaymentIntent } from '@/lib/payment-intent'
import { sendToReview } from '@/lib/customer-settle'
import { money } from '@/lib/wallet-guard'

export type AgentSettleResult =
  | { kind: 'credited'; amount: number; newBalance: number }
  | { kind: 'already' }
  | { kind: 'review' }

export async function settleAgentTransfer(
  client: PrismaClient,
  input: { intent: PaymentIntent; reference: string; amountNaira: number; via: 'Moniepoint transfer' | 'Staff by hand'; note?: string },
): Promise<AgentSettleResult> {
  const { intent, reference, via } = input
  if (intent.status !== INTENT_PENDING) return { kind: 'already' }

  const agent = intent.agentId ? await client.agent.findUnique({ where: { id: intent.agentId } }) : null
  if (!agent) {
    await sendToReview(client, intent, reference, 'the agent on this payment no longer exists')
    return { kind: 'review' }
  }

  const amount = money(input.amountNaira)
  if (!(amount > 0)) {
    await sendToReview(client, intent, reference, `no usable amount (${input.amountNaira}), expected ₦${intent.amount}`)
    return { kind: 'review' }
  }

  let newBalance = 0
  try {
    await client.$transaction(async (tx) => {
      // Atomically consume the intent; a losing or replayed call must not credit.
      const consumed = await consumePaymentIntent(tx, reference, { agentId: agent.id })
      if (!consumed) throw new Error('ALREADY_PROCESSED')
      const updated = await tx.agent.update({ where: { id: agent.id }, data: { walletBalance: { increment: amount } } })
      newBalance = updated.walletBalance
      await tx.transaction.create({
        data: {
          ref: reference, agentId: agent.id, type: 'wallet_funding', amount, method: 'Transfer', status: 'Done',
          note: input.note ?? `Wallet top-up by bank transfer — ${via}`, walletAfter: updated.walletBalance,
        },
      })
    })
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'ALREADY_PROCESSED') return { kind: 'already' }
    if ((e as { code?: unknown } | null)?.code === 'P2002' && await client.transaction.findUnique({ where: { ref: reference }, select: { id: true } })) {
      return { kind: 'already' }
    }
    throw e
  }

  logAudit({
    action: 'wallet_fund_transfer',
    entity: 'Wallet',
    entityId: agent.id,
    details: `Bank-transfer wallet top-up ₦${amount} for ${agent.name} (${agent.agentId}) via ${via} — ref ${reference}`,
    actorType: 'system',
    actorName: via,
  })
  return { kind: 'credited', amount, newBalance }
}
