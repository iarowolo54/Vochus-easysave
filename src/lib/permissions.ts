// Permission catalog and pure authorization core for super-admin user management.
// No framework, Prisma, or side-effect imports: guards and routes consume this.

export const AREA_KEYS = ['agents', 'customers', 'loans', 'money', 'cards', 'oversight'] as const

export type Area = (typeof AREA_KEYS)[number]

// Areas whose actions move money. Kept separate so UI and guards can flag them.
export const MONEY_AREAS: readonly Area[] = ['agents', 'customers', 'loans', 'money']

export const AREA_LABELS: Record<Area, string> = {
  agents: 'Agents',
  customers: 'Customers',
  loans: 'Loans',
  money: 'Money',
  cards: 'Cards',
  oversight: 'Oversight',
}

export const AREA_UNLOCKS: Record<Area, string> = {
  agents:
    'Agent accounts, agent wallets, withdrawals, commission, rewards (includes approving agent payouts)',
  customers:
    'Customer accounts, savings monitor, early redemptions (includes approving redemptions)',
  loans: 'Loan requests, disbursements, repayments (includes disbursing loans)',
  money: 'Treasury, wallet accounts, transactions, payout mode (includes flipping payout Auto/Manual)',
  cards: 'Card management, generation, gift-card design',
  oversight: 'Devices, audit log, reports',
}

export type AccessDecision = 'allow' | 'deny-401' | 'deny-403'

function isArea(value: unknown): value is Area {
  return typeof value === 'string' && (AREA_KEYS as readonly string[]).includes(value)
}

// Parses a stored JSON array of area keys. Unknown entries, non-strings and
// duplicates are dropped; malformed or non-array input yields [].
export function parsePermissions(raw: string | null | undefined): Area[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: Area[] = []
  for (const entry of parsed) {
    if (isArea(entry) && !out.includes(entry)) out.push(entry)
  }
  return out
}

export function hasArea(perms: Area[], area: Area): boolean {
  return perms.includes(area)
}

export function isAdminAreaRole(role: unknown): boolean {
  return role === 'superadmin' || role === 'staff'
}

export function decideAdminAccess(input: {
  role: unknown
  area: Area | null
  staffStatus?: string | null
  roleStatus?: string | null
  rolePerms?: Area[] | null
}): AccessDecision {
  const { role, area, staffStatus, roleStatus, rolePerms } = input
  if (!role) return 'deny-401'
  if (role === 'superadmin') return 'allow'
  if (role === 'staff') {
    if (staffStatus !== 'Active') return 'deny-403'
    if (area === null) return 'allow'
    if (roleStatus === 'Active' && hasArea(rolePerms ?? [], area)) return 'allow'
    return 'deny-403'
  }
  return 'deny-403'
}

// Validates a client-supplied permission list for a role. Strict: unknown string
// keys are reported (never silently dropped); any non-string entry makes the whole
// input invalid (reported stringified) so a typo can't quietly under-grant.
export function validateRolePermissions(
  input: unknown,
): { ok: true; areas: Area[] } | { ok: false; unknown: string[] } {
  if (!Array.isArray(input)) return { ok: false, unknown: [] }
  const unknown: string[] = []
  const areas: Area[] = []
  for (const entry of input) {
    if (isArea(entry)) {
      if (!areas.includes(entry)) areas.push(entry)
    } else {
      unknown.push(typeof entry === 'string' ? entry : String(JSON.stringify(entry) ?? entry))
    }
  }
  if (unknown.length > 0) return { ok: false, unknown }
  return { ok: true, areas }
}
