// Interim server-side guard for enrolment photos (#8).
//
// The product rule is "photo taken with the camera at that moment, no gallery".
// That CANNOT be verified server-side — a true live-photo guarantee needs a
// liveness / selfie-verification provider. This guard only does what the server
// can: reject a direct API call that attaches something that isn't a reasonable
// image (wrong type, not a data URL, malformed base64, or oversized). Photos are
// optional, so a missing value passes.
const ALLOWED = /^data:image\/(png|jpe?g|webp);base64,/i
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB decoded

export function validatePhoto(input: unknown): { ok: true } | { ok: false; error: string } {
  if (input === undefined || input === null || input === '') return { ok: true }
  if (typeof input !== 'string') return { ok: false, error: 'Photo must be an image data URL' }
  if (!ALLOWED.test(input)) return { ok: false, error: 'Photo must be a JPEG, PNG or WebP image' }

  const b64 = input.slice(input.indexOf(',') + 1)
  // Size first (cheap, from length) so an oversized blob is rejected before we
  // scan the whole string.
  const approxBytes = Math.floor((b64.length * 3) / 4)
  if (approxBytes > MAX_BYTES) return { ok: false, error: 'Photo is too large (max 5 MB)' }
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { ok: false, error: 'Photo is not valid image data' }

  return { ok: true }
}
