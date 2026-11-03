// Typo-tolerant matching for the agent's customer search.

export type SearchableCustomer = {
  firstName: string
  lastName: string
  phone: string | null
  customerId: string | null
}

export function normalise(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// Edit distance where a swapped pair of neighbouring letters ("Adaeze" / "Adeaze") costs one.
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}

// Short words allow no slips (too many false hits); longer ones allow one or two.
function allowedSlips(len: number): number {
  return len <= 3 ? 0 : len <= 6 ? 1 : 2
}

function termMatchesName(term: string, name: string): boolean {
  if (name.includes(term)) return true
  const slips = allowedSlips(term.length)
  if (!slips) return false
  // Compare against the whole name and its same-length start, so a half-typed name still matches.
  return editDistance(term, name) <= slips || editDistance(term, name.slice(0, term.length)) <= slips
}

export function matchesCustomer(terms: string[], c: SearchableCustomer): boolean {
  const names = [normalise(c.firstName), normalise(c.lastName)]
  const phone = (c.phone ?? '').replace(/\D/g, '')
  const id = normalise(c.customerId ?? '')
  return terms.every(raw => {
    const term = normalise(raw)
    if (!term) return true
    const digits = term.replace(/\D/g, '')
    if (digits.length >= 3 && digits.length === term.replace(/[\s\-+()]/g, '').length && phone.includes(digits)) return true
    if (id.includes(term)) return true
    return names.some(n => termMatchesName(term, n))
  })
}
