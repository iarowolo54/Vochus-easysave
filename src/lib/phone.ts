/**
 * Normalises a Nigerian phone number to the canonical 0-prefixed form.
 * Trims, strips spaces and dashes, then folds a leading `+234` or a
 * 13-digit `234...` prefix to `0`. Anything else is returned stripped but
 * otherwise unchanged; callers are responsible for validating shape.
 */
export function normalizePhone(raw: string): string {
  const stripped = raw.trim().replace(/[\s-]/g, '')
  if (stripped.startsWith('+234')) return '0' + stripped.slice(4)
  if (/^234\d{10}$/.test(stripped)) return '0' + stripped.slice(3)
  return stripped
}
