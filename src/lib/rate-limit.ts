// In-memory sliding-window rate limiter for the unauthenticated enrolment
// endpoints (phone-available, email-otp send, invite lookup). It bounds abuse
// and enumeration from a single source.
//
// Scope note: this is per-process. Production runs 2 PM2 cluster instances, so
// a caller spread across both gets up to 2x the nominal budget. That is an
// acceptable soft cap for these endpoints; the limits that must be exact —
// email-send flooding and OTP verify attempts — are enforced in the database
// (EmailOTP rows / the attempts column), which is shared across instances.

import { isIP } from 'node:net'

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterMs: number }

const SWEEP_EVERY_MS = 60_000

export function createRateLimiter() {
  const hits = new Map<string, { times: number[]; windowMs: number }>()
  let lastSweep = 0

  // Keys are per address, so without this the map only ever grows.
  function sweep(now: number) {
    if (now - lastSweep < SWEEP_EVERY_MS) return
    lastSweep = now
    for (const [key, entry] of hits) {
      const newest = entry.times[entry.times.length - 1]
      if (newest === undefined || newest <= now - entry.windowMs) hits.delete(key)
    }
  }

  return {
    // Records a hit for `key` and reports whether it is within `limit` per
    // `windowMs`. `now` is injectable for tests.
    check(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
      sweep(now)
      const cutoff = now - windowMs
      const recent = (hits.get(key)?.times ?? []).filter((t) => t > cutoff)

      if (recent.length >= limit) {
        hits.set(key, { times: recent, windowMs })
        const oldest = recent[0]
        return { allowed: false, remaining: 0, retryAfterMs: oldest + windowMs - now }
      }

      recent.push(now)
      hits.set(key, { times: recent, windowMs })
      return { allowed: true, remaining: limit - recent.length, retryAfterMs: 0 }
    },
    reset() {
      hits.clear()
    },
    size() {
      return hits.size
    },
  }
}

// Shared limiter for enrolment endpoints. Keys are namespaced per endpoint
// (e.g. `phone-available:<ip>`) so budgets don't bleed across endpoints.
export const enrolRateLimiter = createRateLimiter()

// Limiter for the unauthenticated agent lookup behind the login screen, which says whether an account exists
// and what state it's in. The budget is well above what the screen uses: one call per failed sign-in.
export const agentLookupRateLimiter = createRateLimiter()
export const AGENT_LOOKUP_LIMIT = { perIp: 30, windowMs: 60_000 }

/** The rightmost X-Forwarded-For entry is the one our own proxy appended; the rest are client-supplied. Only a real address counts. */
export function rightmostForwardedIp(xff: string | string[] | null | undefined): string | null {
  const header = Array.isArray(xff) ? xff.join(',') : xff
  const ip = header?.split(',').map((s) => s.trim()).filter(Boolean).pop()
  return ip && isIP(ip) ? ip : null
}

// Best-effort client IP from proxy headers. Uses the RIGHTMOST X-Forwarded-For
// entry to resist client-supplied spoofing, matching how the customer login route
// derives the IP.
export function clientIp(req: Request): string {
  const forwarded = rightmostForwardedIp(req.headers.get('x-forwarded-for'))
  if (forwarded) return forwarded
  const real = req.headers.get('x-real-ip')?.trim()
  return real && isIP(real) ? real : 'unknown'
}

// Ajo join codes: a signed-in customer looking up or joining by code. Codes only resolve for their own agent's groups,
// so this just stops a customer from walking through codes.
export const ajoCodeRateLimiter = createRateLimiter()
export const AJO_CODE_LIMIT = { perCustomer: 10, windowMs: 10 * 60_000 }
export const AJO_PAY_LIMIT = { perCustomer: 6, windowMs: 10 * 60_000 }
