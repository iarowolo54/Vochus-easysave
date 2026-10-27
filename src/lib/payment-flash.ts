// One-shot hand-off from the Paystack return page to the home screen ("₦500 added to your savings").
const KEY = 'ves.justPaid'

export function setJustPaid(amount: number) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ amount })) } catch {}
}

/** Returns the amount once, then clears it. */
export function takeJustPaid(): number | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const amount = Number(JSON.parse(raw).amount)
    return Number.isFinite(amount) && amount > 0 ? amount : null
  } catch { return null }
}
