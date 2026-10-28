// Canonical form for matching an email across the OTP send / verify / enrol
// flows, so a difference in casing or surrounding whitespace can't make a
// verified code miss its gate. Used only for lookup/matching — the customer's
// email is still stored as they entered it.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
