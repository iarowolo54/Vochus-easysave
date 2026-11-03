/** Rounds a naira amount to kobo. Kept free of server imports so client code can use it too. */
export function money(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}
