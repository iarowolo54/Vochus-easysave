import { prisma } from '@/lib/prisma'
import { PAYSTACK_ENABLED } from '@/lib/paystack-off'

export type PayoutChannel = 'agent' | 'customer'
export type PayoutMode = 'auto' | 'manual'

export const DEFAULT_PAYOUT_MODE: Record<PayoutChannel, PayoutMode> = {
  agent: 'auto',
  customer: 'auto',
}

// Only an explicit "manual" flips a channel; anything else (missing, unknown,
// wrong type, malformed JSON) resolves to "auto".
export function parsePayoutMode(raw: string | null): Record<PayoutChannel, PayoutMode> {
  let parsed: unknown
  try {
    parsed = raw == null ? null : JSON.parse(raw)
  } catch {
    return { ...DEFAULT_PAYOUT_MODE }
  }
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  return {
    agent: obj.agent === 'manual' ? 'manual' : 'auto',
    customer: obj.customer === 'manual' ? 'manual' : 'auto',
  }
}

// DB errors propagate on purpose: a failed read must not silently fall back to
// "auto" for a channel the admin set to "manual". Callers fail closed.
export async function getPayoutMode(): Promise<Record<PayoutChannel, PayoutMode>> {
  // Automatic payouts go through Paystack, which is closed (src/lib/paystack-off.ts): staff pay and mark paid.
  if (!PAYSTACK_ENABLED) return { agent: 'manual', customer: 'manual' }
  const setting = await prisma.platformSetting.findUnique({ where: { key: 'payoutMode' } })
  return parsePayoutMode(setting?.value ?? null)
}
