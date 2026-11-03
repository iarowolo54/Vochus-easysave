// Select only what the response needs. approvalPin is selected solely to derive the hasApprovalPin
// boolean and is mapped away; password and the invite token hash are never selected.
export const staffSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  lastActiveAt: true,
  createdAt: true,
  approvalPin: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
  roleRef: { select: { id: true, name: true } },
  ledDepartments: { select: { id: true } },
} as const

type StaffRow = {
  id: string
  name: string
  email: string
  status: string
  lastActiveAt: Date | null
  createdAt: Date
  approvalPin: string | null
  departmentId: string | null
  department: { id: string; name: string } | null
  roleRef: { id: string; name: string } | null
  ledDepartments: { id: string }[]
}

export function toStaffResponse(s: StaffRow) {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    status: s.status,
    lastActiveAt: s.lastActiveAt,
    createdAt: s.createdAt,
    department: s.department ? { id: s.department.id, name: s.department.name } : null,
    role: s.roleRef ? { id: s.roleRef.id, name: s.roleRef.name } : null,
    isLead: s.departmentId != null && s.ledDepartments.some((d) => d.id === s.departmentId),
    hasApprovalPin: s.approvalPin != null,
  }
}
