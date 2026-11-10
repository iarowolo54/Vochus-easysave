'use client'

import { useEffect, useRef } from 'react'
import { Icons } from '@/components/ui/icons'
import { SCREENS, canGrant, type Perm } from '@/lib/permissions'

export const ACCESS_GROUPS = [...new Set(SCREENS.map(s => s.group))]

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

/** Every token of the given screens, or only those a department lead may give. */
export function permsOf(screens: readonly (typeof SCREENS)[number][], ceiling?: Perm[] | null): Perm[] {
  return screens
    .flatMap(s => (s.actions as readonly string[]).map(a => `${s.key}:${a}` as Perm))
    .filter(p => !ceiling || canGrant(ceiling, [p]))
}

function GroupCheck({ label, checked, partial, disabled, onChange }: { label: string; checked: boolean; partial: boolean; disabled: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = partial }, [partial])
  return <input ref={ref} type="checkbox" className="um-check" aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
}

/**
 * Per-screen View / Manage grid, grouped like the nav. `ceiling` (for a department lead) disables
 * every cell the lead doesn't hold themselves; the server enforces the same bound. Passing
 * `openGroups` turns each group into a collapsible block with a tick-all box.
 */
export default function PermissionMatrix({ value, onChange, ceiling, idPrefix, disabled = false, openGroups, onToggleGroup }: {
  value: Perm[]
  onChange: (next: Perm[]) => void
  ceiling?: Perm[] | null
  idPrefix: string
  disabled?: boolean
  openGroups?: ReadonlySet<string>
  onToggleGroup?: (group: string) => void
}) {
  const allowed = (p: Perm) => !disabled && (!ceiling || canGrant(ceiling, [p]))
  const collapsible = !!openGroups

  return (
    <div className="cs-matrix" role="group" aria-label="Screen access">
      {ACCESS_GROUPS.map(g => {
        const screens = SCREENS.filter(s => s.group === g)
        const open = !collapsible || openGroups.has(g)
        const onCount = screens.filter(s => value.includes(`${s.key}:view` as Perm) || value.includes(`${s.key}:manage` as Perm)).length
        const grantable = permsOf(screens, ceiling)
        const allOn = grantable.length > 0 && grantable.every(p => value.includes(p))
        const someOn = grantable.some(p => value.includes(p))
        return (
          <div key={g} className={collapsible ? 'um-group' : 'cs-matrix-group'}>
            {collapsible ? (
              <div className="um-group-hd">
                <button type="button" className="um-group-btn" aria-expanded={open} onClick={() => onToggleGroup?.(g)}>
                  <Icons.back size={18} aria-hidden="true" className={open ? 'um-chev is-open' : 'um-chev'} />
                  <span className="td-name">{g}</span>
                  <span className="cs-muted">{onCount} of {screens.length}</span>
                </button>
                <GroupCheck label={`All of ${g}`} checked={allOn} partial={someOn && !allOn} disabled={disabled || grantable.length === 0}
                  onChange={() => onChange(allOn ? value.filter(p => !grantable.includes(p)) : [...new Set([...value, ...grantable])])} />
              </div>
            ) : <div className="cs-matrix-gh">{g}</div>}

            {open && (
              <div className={collapsible ? 'um-group-body' : undefined}>
                {screens.map(s => {
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
            )}
          </div>
        )
      })}
    </div>
  )
}
