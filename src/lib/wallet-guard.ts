import { NextResponse } from 'next/server'

export function money(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

export class InsufficientFundsError extends Error {
  constructor(public wallet: string, public balance: number, public needed: number) {
    super(`Insufficient ${wallet} balance: have ₦${money(balance)}, need ₦${money(needed)}`)
  }
}

export function assertSufficient(wallet: string, balance: number, needed: number) {
  if (money(balance) < money(needed)) {
    throw new InsufficientFundsError(wallet, balance, needed)
  }
}

export function insufficientResponse(err: InsufficientFundsError) {
  return NextResponse.json(
    {
      error: err.message,
      code: 'INSUFFICIENT_FUNDS',
      wallet: err.wallet,
      balance: money(err.balance),
      needed: money(err.needed),
    },
    { status: 400 }
  )
}

/** Largest single admin wallet top-up (NGN). */
export const MAX_ADMIN_FUND = 10_000_000

/** A positive, finite number with at most 2 decimals and no larger than `max`. */
export function isValidAmount(n: unknown, max: number): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0.01 && n <= max && money(n) === n
}
