import { NextResponse } from 'next/server'

/** The exact 409 returned when a phone/email is already used by any account. */
export function identityConflictResponse(conflict: 'phone' | 'email'): NextResponse {
  const error = conflict === 'phone' ? 'This phone number is already registered.' : 'This email is already registered.'
  return NextResponse.json({ error }, { status: 409 })
}
