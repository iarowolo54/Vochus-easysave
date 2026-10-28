// Redemption token hashing-at-rest. The 6-digit redemption codes are delivered
// to the customer out-of-band (SMS/email) and only the SHA-256 hash is stored
// in EarlyRedemption.token, so a database read never exposes a usable code.
// Lookups and comparisons hash the incoming code and match against the stored
// hash; the column stays @unique because the hash is a function of the code.
import { createHash, timingSafeEqual } from 'node:crypto'

export function hashRedemptionToken(raw: string): string {
  return createHash('sha256').update(String(raw).trim()).digest('hex')
}

// Constant-time comparison of a submitted code against a stored hash.
export function redemptionTokenMatches(stored: string | null | undefined, raw: string): boolean {
  if (!stored) return false
  const a = Buffer.from(stored, 'utf8')
  const b = Buffer.from(hashRedemptionToken(raw), 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
