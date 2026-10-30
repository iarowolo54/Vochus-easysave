import type { PrismaClient } from '@prisma/client'
import { pauseMandate } from '@/lib/auto-debit'

type Client = Pick<PrismaClient, 'autoDebitMandate' | 'autoDebitAttempt' | 'savingsPlan'>

export const MAX_CONSECUTIVE_FAILURES = 3

// Card errors a retry cannot fix: pause at once instead of waiting for repeated failures.
const UNRECOVERABLE = /expired|invalid|do not honou?r|blacklisted/i

/**
 * Record a failed auto-debit charge. Idempotent per attempt reference: an attempt
 * already marked failed is not counted twice. Pauses the mandate immediately on an
 * unrecoverable card error, otherwise after MAX_CONSECUTIVE_FAILURES in a row.
 */
export async function recordAutoDebitFailure(
  client: Client,
  input: { reference: string; gatewayResponse: string },
): Promise<{ paused: boolean }> {
  const attempt = await client.autoDebitAttempt.findUnique({ where: { reference: input.reference } })
  if (!attempt) return { paused: false }

  if (attempt.status === 'failed') {
    const m = await client.autoDebitMandate.findUnique({ where: { id: attempt.mandateId }, select: { status: true } })
    return { paused: m?.status === 'paused' }
  }

  // Conditional flip so two concurrent callers cannot both count the same attempt.
  const flipped = await client.autoDebitAttempt.updateMany({
    where: { id: attempt.id, status: { not: 'failed' } },
    data: { status: 'failed', gatewayResponse: input.gatewayResponse },
  })
  if (flipped.count === 0) {
    const m = await client.autoDebitMandate.findUnique({ where: { id: attempt.mandateId }, select: { status: true } })
    return { paused: m?.status === 'paused' }
  }

  const mandate = await client.autoDebitMandate.update({
    where: { id: attempt.mandateId },
    data: { consecutiveFailures: { increment: 1 } },
    select: { id: true, consecutiveFailures: true },
  })

  const pause = UNRECOVERABLE.test(input.gatewayResponse) || mandate.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
  if (pause) await pauseMandate(client, mandate.id)
  return { paused: pause }
}
