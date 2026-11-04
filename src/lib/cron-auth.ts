import { timingSafeEqual } from 'node:crypto'

/** Constant-time bearer check. Fails closed when CRON_SECRET is unset/empty. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer (.+)$/.exec(header)
  if (!match) return false
  const given = Buffer.from(match[1])
  const expected = Buffer.from(secret)
  // timingSafeEqual throws on unequal lengths; a length mismatch is simply a rejection.
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}
