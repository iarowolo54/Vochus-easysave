// Permission catalog and pure authorization core for super-admin user management.
// No framework, Prisma, or side-effect imports: guards, routes and UI consume this.
// A permission is a "<screen>:<action>" token; manage always carries view.

export type Action = 'view' | 'manage'

type ScreenDef = {
  key: string
  label: string
  group: string
  actions: readonly Action[]
  /** Manage on this screen moves or commits money; UI flags it and staff need an approval PIN. */
  handlesMoney?: boolean
  /** What Manage covers, shown next to the checkbox. */
  manageNote?: string
}

const VM = ['view', 'manage'] as const
const V = ['view'] as const

export const SCREENS = [
  { key: 'agents', label: 'Agents', group: 'Agents', actions: VM, manageNote: 'Activate, block, lock profile, reset device, invite, approve documents' },
  { key: 'agent-requests', label: 'Agent requests', group: 'Agents', actions: VM, manageNote: 'Approve or turn down customers becoming agents; approving closes their customer account' },
  { key: 'agent-wallets', label: 'Agent wallets', group: 'Agents', actions: V },
  { key: 'withdrawals', label: 'Agent withdrawals', group: 'Agents', actions: VM, handlesMoney: true, manageNote: 'Approve, decline and finalize agent withdrawals' },
  { key: 'commission', label: 'Commission', group: 'Agents', actions: VM, manageNote: 'Set commission rates' },
  { key: 'rewards', label: 'Rewards', group: 'Agents', actions: VM, manageNote: 'Create, edit and delete rewards' },
  { key: 'customers', label: 'Customers', group: 'Customers', actions: VM, manageNote: 'Change customer status' },
  { key: 'customer-requests', label: 'Customer requests', group: 'Customers', actions: VM, manageNote: 'Approve or deny new cash savers; approving takes the registration fee from the agent’s wallet' },
  { key: 'ajo', label: 'Ajo groups', group: 'Customers', actions: VM, handlesMoney: true, manageNote: 'Replace a member' },
  { key: 'savings', label: 'Savings monitor', group: 'Customers', actions: VM, manageNote: 'Savings interest and interest rates' },
  { key: 'redemptions', label: 'Redemptions', group: 'Customers', actions: VM, handlesMoney: true, manageNote: 'Approve, decline and finalize redemptions' },
  { key: 'loans', label: 'Loan requests', group: 'Loans', actions: VM, handlesMoney: true, manageNote: 'Approve or reject loan requests' },
  { key: 'loan-disbursements', label: 'Loan disbursements', group: 'Loans', actions: VM, handlesMoney: true, manageNote: 'Disburse loans' },
  { key: 'loan-repayments', label: 'Loan repayments', group: 'Loans', actions: VM, handlesMoney: true, manageNote: 'Record repayments' },
  { key: 'treasury', label: 'Treasury', group: 'Money', actions: VM, handlesMoney: true, manageNote: 'Fund wallets, inject capital, commission payout' },
  { key: 'bank-transfers', label: 'Bank transfers', group: 'Money', actions: VM, handlesMoney: true, manageNote: 'Credit a transfer by hand' },
  { key: 'transactions', label: 'Transactions', group: 'Money', actions: V },
  { key: 'payout-mode', label: 'Payouts & top-ups', group: 'Money', actions: VM, handlesMoney: true, manageNote: 'Switch payouts between Auto and Manual, and top-ups between bank transfer and card' },
  { key: 'cards', label: 'Cards', group: 'Cards', actions: VM, manageNote: 'Generate cards' },
  { key: 'devices', label: 'Devices', group: 'Oversight', actions: VM, manageNote: 'Reset a device' },
  { key: 'audit', label: 'Audit log', group: 'Oversight', actions: V },
  { key: 'messages', label: 'Pop-up messages', group: 'Oversight', actions: VM, manageNote: 'Create, edit, switch off and delete pop-up messages' },
  { key: 'reports', label: 'Reports', group: 'Oversight', actions: VM, manageNote: 'Update the status of a report' },
  { key: 'support', label: 'Support chat', group: 'Oversight', actions: VM, manageNote: 'Reply to agents and customers, start a chat, close or reopen one' },
] as const satisfies readonly ScreenDef[]

export type ScreenKey = (typeof SCREENS)[number]['key']
export type Perm = `${ScreenKey}:${Action}`
export type AccessDecision = 'allow' | 'deny-401' | 'deny-403'

export const MONEY_SCREENS: readonly ScreenKey[] = (SCREENS as readonly ScreenDef[])
  .filter((s) => s.handlesMoney)
  .map((s) => s.key as ScreenKey)

const VALID_PERMS: ReadonlySet<string> = new Set(
  (SCREENS as readonly ScreenDef[]).flatMap((s) => s.actions.map((a) => `${s.key}:${a}`)),
)

function isPerm(value: unknown): value is Perm {
  return typeof value === 'string' && VALID_PERMS.has(value)
}

// Every x:manage also carries x:view; duplicates dropped.
function normalize(perms: readonly Perm[]): Perm[] {
  const out = new Set<Perm>()
  for (const p of perms) {
    out.add(p)
    if (p.endsWith(':manage')) out.add(`${p.slice(0, -':manage'.length)}:view` as Perm)
  }
  return [...out]
}

// Parses a stored JSON array of permission tokens. Invalid entries, non-strings and
// duplicates are dropped; malformed or non-array input yields [].
export function parsePermissions(raw: string | null | undefined): Perm[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return normalize(parsed.filter(isPerm))
}

export function hasPermission(perms: readonly Perm[], screen: ScreenKey, action: Action): boolean {
  if (action === 'view') return perms.includes(`${screen}:view`) || perms.includes(`${screen}:manage`)
  return perms.includes(`${screen}:manage`)
}

// Validates a client-supplied permission list for a role. Strict: unknown tokens are
// reported (never silently dropped); a non-string entry makes the whole input invalid
// (reported stringified) so a typo can't quietly under-grant.
export function validateRolePermissions(
  input: unknown,
): { ok: true; perms: Perm[] } | { ok: false; unknown: string[] } {
  if (!Array.isArray(input)) return { ok: false, unknown: [] }
  const unknown: string[] = []
  const perms: Perm[] = []
  for (const entry of input) {
    if (isPerm(entry)) perms.push(entry)
    else unknown.push(typeof entry === 'string' ? entry : String(JSON.stringify(entry) ?? entry))
  }
  if (unknown.length > 0) return { ok: false, unknown }
  return { ok: true, perms: normalize(perms) }
}

// The lead escalation bound: every requested token must already be in the granter's
// normalized set (so a holder of x:manage can grant x:view).
export function canGrant(granter: readonly Perm[], requested: readonly Perm[]): boolean {
  const ceiling = new Set(normalize(granter))
  return normalize(requested).every((p) => ceiling.has(p))
}

// A non-owner may edit a role only if both what it holds now and what it will hold
// are within their own ceiling: they can't touch a role above them, nor launder
// permissions by dropping and re-adding.
export function canEditRole(granter: readonly Perm[], current: readonly Perm[], resulting: readonly Perm[]): boolean {
  return canGrant(granter, current) && canGrant(granter, resulting)
}

export function isAdminAreaRole(role: unknown): boolean {
  return role === 'superadmin' || role === 'staff'
}

export function decideAdminAccess(input: {
  role: unknown
  screen: ScreenKey | null
  action: Action
  staffStatus?: string | null
  roleStatus?: string | null
  rolePerms?: readonly Perm[] | null
}): AccessDecision {
  const { role, screen, action, staffStatus, roleStatus, rolePerms } = input
  if (!role) return 'deny-401'
  if (role === 'superadmin') return 'allow'
  if (role === 'staff') {
    if (staffStatus !== 'Active') return 'deny-403'
    if (screen === null) return 'allow'
    if (roleStatus === 'Active' && hasPermission(rolePerms ?? [], screen, action)) return 'allow'
    return 'deny-403'
  }
  return 'deny-403'
}
