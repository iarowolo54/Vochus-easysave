// Select only what the response needs. approvalPin is selected solely to derive
// the hasApprovalPin boolean and is mapped away; password is never selected.
export const staffSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  lastActiveAt: true,
  createdAt: true,
  approvalPin: true,
  roleRef: {
    select: {
      id: true,
      name: true,
      department: { select: { id: true, name: true } },
    },
  },
} as const

type StaffRow = {
  id: string
  name: string
  email: string
  status: string
  lastActiveAt: Date | null
  createdAt: Date
  approvalPin: string | null
  roleRef: { id: string; name: string; department: { id: string; name: string } } | null
}

export function toStaffResponse(s: StaffRow) {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    status: s.status,
    lastActiveAt: s.lastActiveAt,
    createdAt: s.createdAt,
    role: s.roleRef
      ? {
          id: s.roleRef.id,
          name: s.roleRef.name,
          department: { id: s.roleRef.department.id, name: s.roleRef.department.name },
        }
      : null,
    hasApprovalPin: s.approvalPin != null,
  }
}
