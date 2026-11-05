// Who may receive sign-in and payment emails. Both conditions are the customer's own doing:
// they proved the address with a code, and they have not switched alerts off.
export function alertEmailFor(c: { email: string | null; emailVerifiedAt: Date | null; emailAlertsOn: boolean }): string | null {
  const email = c.email?.trim()
  return email && c.emailVerifiedAt && c.emailAlertsOn ? email : null
}
