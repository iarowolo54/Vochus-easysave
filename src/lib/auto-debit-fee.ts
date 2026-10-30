import { money } from '@/lib/wallet-guard'

const RATE = 0.015
const FLAT = 100
const FLAT_THRESHOLD = 2500
const FEE_CAP = 2000

/** Paystack NGN local-card fee: 1.5%, +N100 when amount >= N2,500, capped at N2,000. */
export function paystackFee(amountNaira: number): number {
  const flat = amountNaira >= FLAT_THRESHOLD ? FLAT : 0
  return money(Math.min(amountNaira * RATE + flat, FEE_CAP))
}

/** Smallest amount to charge so that the net after Paystack's fee covers `creditNaira`. */
export function grossUpForFee(creditNaira: number): { grossCharged: number; feeEstimate: number } {
  let g = money(creditNaira / (1 - RATE))
  if (g >= FLAT_THRESHOLD) g = money((creditNaira + FLAT) / (1 - RATE))
  // Cap region: fee is flat 2000, so gross = credit + 2000 when that is smaller.
  const capped = money(creditNaira + FEE_CAP)
  if (capped < g) g = capped
  while (money(g - paystackFee(g)) < creditNaira) g = money(g + 0.01)
  return { grossCharged: g, feeEstimate: paystackFee(g) }
}
