// Redemption token hashing-at-rest. The 6-digit redemption codes are delivered
// to the customer out-of-band (SMS/email) and only the SHA-256 hash is stored
// in EarlyRedemption.token. Lookups and comparisons hash the incoming code and
// match against the stored hash; the column stays @unique because the hash is a
// deterministic function of the code.
//
// This is defence-in-depth, not a strong guarantee: the code space is only
// 1,000,000 values, so a leaked hash is brute-forceable offline. It stops a
// plaintext code from sitting in the DB, logs, or admin payloads; the real
// controls on use are session ownership, single-use status, and expiry.
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
