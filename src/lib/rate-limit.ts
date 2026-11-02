// In-memory sliding-window rate limiter for the unauthenticated enrolment
// endpoints (phone-available, email-otp send, invite lookup). It bounds abuse
// and enumeration from a single source.
//
// Scope note: this is per-process. Production runs 2 PM2 cluster instances, so
// a caller spread across both gets up to 2x the nominal budget. That is an
// acceptable soft cap for these endpoints; the limits that must be exact —
// email-send flooding and OTP verify attempts — are enforced in the database
// (EmailOTP rows / the attempts column), which is shared across instances.

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterMs: number }

export function createRateLimiter() {
  const hits = new Map<string, number[]>()

  return {
    // Records a hit for `key` and reports whether it is within `limit` per
    // `windowMs`. `now` is injectable for tests.
    check(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
      const cutoff = now - windowMs
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff)

      if (recent.length >= limit) {
        hits.set(key, recent)
        const oldest = recent[0]
        return { allowed: false, remaining: 0, retryAfterMs: oldest + windowMs - now }
      }

      recent.push(now)
      hits.set(key, recent)
      return { allowed: true, remaining: limit - recent.length, retryAfterMs: 0 }
    },
    reset() {
      hits.clear()
    },
  }
}

// Shared limiter for enrolment endpoints. Keys are namespaced per endpoint
// (e.g. `phone-available:<ip>`) so budgets don't bleed across endpoints.
export const enrolRateLimiter = createRateLimiter()

// Limiter for the agent code-only redemption lookup (`lookup-token`). That route
// resolves a redemption from the 6-digit code alone, so a wrong guess matches no
// record and can't be capped per-redemption the way `verify-token` is — a soft
// per-agent cap bounds brute-forcing the code space. Keyed by agent id.
export const redemptionLookupRateLimiter = createRateLimiter()

// Limiter for the two unauthenticated agent lookups behind the login screen, which say whether an account exists
// and what state it's in. The budget is well above what the screen uses: one call per failed sign-in.
export const agentLookupRateLimiter = createRateLimiter()
export const AGENT_LOOKUP_LIMIT = { perIp: 30, windowMs: 60_000 }

// Best-effort client IP from proxy headers. Uses the RIGHTMOST X-Forwarded-For
// entry (the one our own proxy appended) to resist client-supplied spoofing,
// matching how the customer login route derives the IP.
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}
