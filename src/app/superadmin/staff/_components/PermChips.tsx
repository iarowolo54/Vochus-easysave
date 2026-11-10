import { SCREENS, MONEY_SCREENS, type ScreenKey } from '@/lib/permissions'

const LABELS = new Map<string, string>(SCREENS.map(s => [s.key, s.label]))

/** Compact summary of a role's access: one chip per screen, "Manage" marked, money screens amber. */
export default function PermChips({ perms }: { perms: string[] }) {
  const screens = [...new Set(perms.map(p => p.split(':')[0]))]
  if (screens.length === 0) return <span className="cs-muted">No access</span>
  return (
    <span className="cs-chips">
      {screens.map(k => {
        const manage = perms.includes(`${k}:manage`)
        const money = manage && MONEY_SCREENS.includes(k as ScreenKey)
        return <span key={k} className={`cs-chip${money ? ' cs-chip-money' : ''}`}>{LABELS.get(k) ?? k}{manage ? ' · Manage' : ''}</span>
      })}
    </span>
  )
}
