// Typo-tolerant matching for admin search boxes. Small tables only (customers, agents):
// callers load a few short columns and rank them here, since SQLite has no fuzzy search.

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Edit distance counting a swap of two neighbouring letters ("adna" -> "anda") as one mistake. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** Mistakes allowed in one typed word: none for 1–2 letters, one for short words, two for longer ones. */
const allowance = (len: number) => (len <= 2 ? 0 : len <= 4 ? 1 : 2)

/** Cost of one typed word against one target word; null if it doesn't match. 0 = exact or starts with it. */
function wordCost(w: string, t: string): number | null {
  if (t.startsWith(w)) return 0
  if (t.includes(w)) return 0.5
  const max = allowance(w.length)
  if (max === 0) return null
  // Compare against the same-length start of the word too, so a half-typed, misspelled name still matches.
  const prefix = t.slice(0, w.length)
  const d = Math.min(Math.abs(w.length - t.length) > max ? Infinity : distance(w, t), distance(w, prefix))
  return d <= max ? d : null
}

/** Lower is better, null means no match. Every typed word must match one of the fields' words. */
export function fuzzyScore(query: string, fields: (string | null | undefined)[]): number | null {
  const words = norm(query.slice(0, 64)).split(' ').filter(Boolean).slice(0, 5).map(w => w.slice(0, 32))
  if (!words.length) return null
  const targets = fields.flatMap(f => (f ? norm(f.slice(0, 80)).split(' ') : [])).filter(Boolean)
  let total = 0
  for (const w of words) {
    let best: number | null = null
    for (const t of targets) {
      const c = wordCost(w, t)
      if (c !== null && (best === null || c < best)) best = c
    }
    if (best === null) return null
    total += best
  }
  return total
}

/** Ids of the best matches, best first. */
export function rankMatches<T>(query: string, rows: T[], fields: (r: T) => (string | null | undefined)[], limit: number): T[] {
  return rows
    .map(r => ({ r, s: fuzzyScore(query, fields(r)) }))
    .filter((x): x is { r: T; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map(x => x.r)
}
