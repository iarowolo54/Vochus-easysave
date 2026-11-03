'use client'

import { useState, useEffect, useCallback } from 'react'
import { Icons } from '@/components/ui/icons'
import { ConfirmModal, Empty, Field, LoadError, Modal, TableSkeleton } from '../../_components/admin-ui'
import { SCREENS, MONEY_SCREENS, canEditRole, canGrant, type Perm, type ScreenKey } from '@/lib/permissions'
import PermissionMatrix from './PermissionMatrix'
import { type RoleRow, sendJson } from './shared'

const LABELS = new Map<string, string>(SCREENS.map(s => [s.key, s.label]))

/** Compact summary of a role's access: one chip per screen, "Manage" marked, money screens amber. */
export function PermChips({ perms }: { perms: string[] }) {
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

export default function RolesView({ departmentId, departmentName, ceiling, toast, onChanged }: {
  departmentId: string
  departmentName: string
  /** null for the owner (unbounded); a lead's own permissions otherwise. */
  ceiling: Perm[] | null
  toast: (m: string, t?: 'success' | 'error') => void
  onChanged?: () => void
}) {
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null)
  const [name, setName] = useState('')
  const [perms, setPerms] = useState<Perm[]>([])
  const [nameError, setNameError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const [statusTarget, setStatusTarget] = useState<RoleRow | null>(null)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch(`/api/admin/roles?departmentId=${encodeURIComponent(departmentId)}`)
      if (!res.ok) throw new Error()
      const d = await res.json()
      setRoles(d.roles ?? [])
    } catch { setFailed(true) } finally { setLoading(false) }
  }, [departmentId])
  useEffect(() => { setRoles([]); load() }, [load])

  // A lead can only touch roles whose access is within their own.
  const editable = (r: RoleRow) => !ceiling || canGrant(ceiling, r.permissions as Perm[])

  function open(r: RoleRow | 'new') {
    setEditing(r); setNameError(''); setFormError('')
    setName(r === 'new' ? '' : r.name)
    setPerms(r === 'new' ? [] : (r.permissions as Perm[]))
  }

  async function save() {
    if (!editing) return
    if (!name.trim()) { setNameError('Enter a role name.'); return }
    if (ceiling && editing !== 'new' && !canEditRole(ceiling, editing.permissions as Perm[], perms)) {
      setFormError('You can only give a role access you hold yourself.'); return
    }
    setBusy(true); setFormError('')
    const r = editing === 'new'
      ? await sendJson('/api/admin/roles', 'POST', { name: name.trim(), departmentId, permissions: perms })
      : await sendJson(`/api/admin/roles/${editing.id}`, 'PATCH', { name: name.trim(), permissions: perms })
    setBusy(false)
    if (!r.ok) { setFormError(r.error); return }
    toast(editing === 'new' ? `${name.trim()} role created` : 'Role updated', 'success')
    setEditing(null); load(); onChanged?.()
  }

  async function toggleStatus() {
    const r0 = statusTarget
    if (!r0) return
    const next = r0.status === 'Active' ? 'Archived' : 'Active'
    setBusy(true); setActionError('')
    const r = await sendJson(`/api/admin/roles/${r0.id}`, 'PATCH', { status: next })
    setBusy(false)
    if (!r.ok) { setActionError(r.error); return }
    toast(`${r0.name} ${next === 'Active' ? 'reactivated' : 'archived'}`, 'success')
    setStatusTarget(null); load(); onChanged?.()
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn btn-green" onClick={() => open('new')}><Icons.add size={18} aria-hidden="true" /> Add role</button>
      </div>

      <section className="card" aria-label={`${departmentName} roles`}>
        {loading && !roles.length ? <TableSkeleton rows={3} cols={4} />
          : failed ? <LoadError what="roles" onRetry={load} />
          : roles.length === 0 ? (
            <Empty icon="staff" title={`No roles in ${departmentName} yet`} text="A role decides which screens its people can view and manage."
              action={<button type="button" className="btn btn-green" onClick={() => open('new')}>Add role</button>} />
          ) : (
            <div className="tbl-wrap tbl-stack">
              <table>
                <thead>
                  <tr><th>Role</th><th>Access</th><th>People</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {roles.map(r => (
                    <tr key={r.id}>
                      <td><span className="td-name ui-block">{r.name}</span></td>
                      <td data-label="Access"><PermChips perms={r.permissions} /></td>
                      <td data-label="People">{r.staffCount}</td>
                      <td data-label="Status">{r.status === 'Active' ? <span className="bdg bdg-g">Active</span> : <span className="bdg bdg-grey">Archived</span>}</td>
                      <td>
                        {editable(r) ? (
                          <div className="a-row-actions">
                            <button type="button" className="btn btn-sm btn-outline" onClick={() => open(r)}>Edit</button>
                            <button type="button" className="btn btn-sm btn-outline" onClick={() => { setActionError(''); setStatusTarget(r) }}>
                              {r.status === 'Active' ? 'Archive' : 'Reactivate'}
                            </button>
                          </div>
                        ) : <span className="cs-muted">Above your access</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {editing && (
        <Modal error={formError || undefined} icon="staff" title={editing === 'new' ? `Add a role to ${departmentName}` : 'Edit role'} busy={busy} size="lg"
          sub={ceiling ? 'You can only give access you hold yourself.' : 'Choose what this role can view and manage.'} onClose={() => { if (!busy) setEditing(null) }}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save role'}</button>
          </>}>
          <form onSubmit={e => { e.preventDefault(); save() }} noValidate>
            <Field id="rl-name" label="Role name" error={nameError}>
              <input id="rl-name" className="a-input" autoComplete="off" placeholder="Payout approver" value={name} aria-invalid={!!nameError}
                onChange={e => { setName(e.target.value); setNameError('') }} />
            </Field>
            <PermissionMatrix idPrefix="rl" value={perms} onChange={setPerms} ceiling={ceiling} />
          </form>
        </Modal>
      )}

      {statusTarget && (
        <ConfirmModal
          title={statusTarget.status === 'Active' ? `Archive ${statusTarget.name}?` : `Reactivate ${statusTarget.name}?`}
          body={statusTarget.status === 'Active'
            ? <>People with this role lose access to its screens until it is reactivated{statusTarget.staffCount ? ` (${statusTarget.staffCount} affected)` : ''}.</>
            : <>People with this role get its access back.</>}
          confirmLabel={statusTarget.status === 'Active' ? 'Archive' : 'Reactivate'}
          danger={statusTarget.status === 'Active'}
          busy={busy} error={actionError}
          onConfirm={toggleStatus} onClose={() => { if (!busy) setStatusTarget(null) }}
        />
      )}
    </>
  )
}
