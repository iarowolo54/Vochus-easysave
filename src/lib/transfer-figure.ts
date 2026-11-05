// "The same figure": two payments less than ₦1 apart. A customer who is shown ₦1,000.37 may send ₦1,000, ₦1,001 or the
// exact amount, so the kobo can't be what tells them apart. One definition, used by every check that guards against
// crediting the same money twice.
import { money } from '@/lib/wallet-guard'

export const HAND_WINDOW_MS = 3 * 86_400_000

export function sameFigure(a: number, b: number): boolean {
  return Math.abs(money(a) - money(b)) < 1
}

/** The same test as a Prisma amount filter. */
export function nearAmount(amount: number): { gt: number; lt: number } {
  return { gt: money(amount - 1), lt: money(amount + 1) }
}
