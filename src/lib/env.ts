// Centralised, fail-closed reads of required secrets/config.
//
// A missing value throws at module load (i.e. at build/startup), so a
// misconfigured environment fails the DEPLOY rather than silently signing
// tokens with a guessable literal fallback or crashing on the first live
// request. Never provide a hardcoded fallback for a secret (see
// .claude/rules/auth-security.md).
//
// Edge-safe: only reads process.env, so it is importable from middleware
// (src/proxy.ts) as well as Node routes.
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}
