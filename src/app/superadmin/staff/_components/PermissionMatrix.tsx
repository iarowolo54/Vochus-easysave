'use client'

import { SCREENS, canGrant, type Perm } from '@/lib/permissions'

const GROUPS = [...new Set(SCREENS.map(s => s.group))]

/** Toggles a screen's view/manage. Manage carries view; clearing view also clears manage. */
function toggle(value: Perm[], screen: string, action: 'view' | 'manage'): Perm[] {
  const view = `${screen}:view` as Perm
  const manage = `${screen}:manage` as Perm
  const rest = value.filter(p => p !== view && p !== manage)
  const hasView = value.includes(view) || value.includes(manage)
  const hasManage = value.includes(manage)
  if (action === 'manage') return hasManage ? [...rest, view] : [...rest, view, manage]
  return hasView ? rest : [...rest, view]
}

/**
 * Per-screen View / Manage grid, grouped like the nav. `ceiling` (for a department lead) disables
 * every cell the lead doesn't hold themselves; the server enforces the same bound.
 */
export default function PermissionMatrix({ value, onChange, ceiling, idPrefix }: {
  value: Perm[]; onChange: (next: Perm[]) => void; ceiling?: Perm[] | null; idPrefix: string
}) {
  const allowed = (p: Perm) => !ceiling || canGrant(ceiling, [p])
  return (
    <div className="cs-matrix" role="group" aria-label="Screen access">
      {GROUPS.map(g => (
        <div key={g} className="cs-matrix-group">
          <div className="cs-matrix-gh">{g}</div>
          {SCREENS.filter(s => s.group === g).map(s => {
            const vKey = `${s.key}:view` as Perm
            const mKey = `${s.key}:manage` as Perm
            const hasManage = (s.actions as readonly string[]).includes('manage')
            const viewOn = value.includes(vKey) || value.includes(mKey)
            return (
              <div key={s.key} className="cs-matrix-row">
                <div className="cs-matrix-name">
                  {s.label}
                  {'manageNote' in s && hasManage && <span className="cs-area-help">{s.manageNote}</span>}
                </div>
                <label className="cs-matrix-cell" htmlFor={`${idPrefix}-${s.key}-v`}>
                  <input id={`${idPrefix}-${s.key}-v`} type="checkbox" checked={viewOn} disabled={!allowed(vKey)}
                    onChange={() => onChange(toggle(value, s.key, 'view'))} />
                  <span>View</span>
                </label>
                {hasManage ? (
                  <label className="cs-matrix-cell" htmlFor={`${idPrefix}-${s.key}-m`}>
                    <input id={`${idPrefix}-${s.key}-m`} type="checkbox" checked={value.includes(mKey)} disabled={!allowed(mKey)}
                      onChange={() => onChange(toggle(value, s.key, 'manage'))} />
                    <span>Manage</span>
                    {'handlesMoney' in s && s.handlesMoney && <span className="cs-chip cs-chip-money">Money</span>}
                  </label>
                ) : <span className="cs-matrix-cell cs-muted" aria-hidden="true">View only</span>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
