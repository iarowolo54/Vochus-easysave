export type AdminIdentity = {
  kind: 'superadmin' | 'staff' | 'none'
  id?: string
  name?: string
  email?: string
}

/**
 * Decides which record is authoritative for an admin-login email.
 * A SuperAdmin row always wins (a StaffUser can never shadow it). The caller
 * still bcrypt-compares against the chosen record and rejects on mismatch.
 */
export function pickIdentity(opts: {
  superAdmin: { id: string; name: string; email: string } | null
  staff: { id: string; name: string; email: string; status: string } | null
}): AdminIdentity {
  const { superAdmin, staff } = opts
  if (superAdmin) {
    return { kind: 'superadmin', id: superAdmin.id, name: superAdmin.name, email: superAdmin.email }
  }
  if (staff && staff.status === 'Active') {
    return { kind: 'staff', id: staff.id, name: staff.name, email: staff.email }
  }
  return { kind: 'none' }
}
