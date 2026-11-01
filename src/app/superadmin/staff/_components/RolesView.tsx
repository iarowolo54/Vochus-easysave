'use client'

import { useState, useEffect, useCallback } from 'react'
import { Icons } from '@/components/ui/icons'
import { ConfirmModal, Empty, Field, LoadError, Modal, TableSkeleton } from '../../_components/admin-ui'
import { AREA_KEYS, AREA_LABELS, AREA_UNLOCKS, MONEY_AREAS, type Area } from '@/lib/permissions'
import { type Department, type RoleRow, sendJson } from './shared'

export function AreaChips({ areas }: { areas: string[] }) {
  if (areas.length === 0) return <span className="cs-muted">No areas</span>
  return (
    <span className="cs-chips">
      {areas.map(a => {
        const k = a as Area
        const money = MONEY_AREAS.includes(k)
        return <span key={a} className={`cs-chip${money ? ' cs-chip-money' : ''}`}>{AREA_LABELS[k] ?? a}</span>
      })}
    </span>
  )
}

export default function RolesView({ toast }: { toast: (m: string, t?: 'success' | 'error') => void }) {
  const [depts, setDepts] = useState<Department[]>([])
  const [deptId, setDeptId] = useState('')
  const [deptLoading, setDeptLoading] = useState(true)
  const [deptFailed, setDeptFailed] = useState(false)

  const [roles, setRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null)
  const [name, setName] = useState('')
  const [areas, setAreas] = useState<Area[]>([])
  const [nameError, setNameError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const [statusTarget, setStatusTarget] = useState<RoleRow | null>(null)
  const [actionError, setActionError] = useState('')

  const loadDepts = useCallback(async () => {
    setDeptLoading(true); setDeptFailed(false)
    try {
      const res = await fetch('/api/admin/departments')
      if (!res.ok) throw new Error()
      const d = await res.json()
      const list: Department[] = d.departments ?? []
      setDepts(list)
      setDeptId(cur => (cur && list.some(x => x.id === cur)) ? cur : (list.find(x => x.status === 'Active') ?? list[0])?.id ?? '')
    } catch { setDeptFailed(true) } finally { setDeptLoading(false) }
  }, [])
  useEffect(() => { loadDepts() }, [loadDepts])

  const loadRoles = useCallback(async () => {
    if (!deptId) return
    setLoading(true); setFailed(false)
    try {
      const res = await fetch(`/api/admin/roles?departmentId=${encodeURIComponent(deptId)}`)
      if (!res.ok) throw new Error()
      const d = await res.json()
      setRoles(d.roles ?? [])
    } catch { setFailed(true) } finally { setLoading(false) }
  }, [deptId])
  useEffect(() => { setRoles([]); loadRoles() }, [loadRoles])

  const dept = depts.find(d => d.id === deptId)

  function open(r: RoleRow | 'new') {
    setEditing(r); setNameError(''); setFormError('')
    setName(r === 'new' ? '' : r.name)
    setAreas(r === 'new' ? [] : r.permissions.filter((p): p is Area => (AREA_KEYS as readonly string[]).includes(p)))
  }

  async function save() {
    if (!editing) return
    if (!name.trim()) { setNameError('Enter a role name.'); return }
    setBusy(true); setFormError('')
    const r = editing === 'new'
      ? await sendJson('/api/admin/roles', 'POST', { name: name.trim(), departmentId: deptId, permissions: areas })
      : await sendJson(`/api/admin/roles/${editing.id}`, 'PATCH', { name: name.trim(), permissions: areas })
    setBusy(false)
    if (!r.ok) { setFormError(r.error); return }
    toast(editing === 'new' ? `${name.trim()} role created` : 'Role updated', 'success')
    setEditing(null); loadRoles(); loadDepts()
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
    setStatusTarget(null); loadRoles()
  }

  if (deptLoading && !depts.length) return <section className="card"><TableSkeleton rows={4} cols={4} /></section>
  if (deptFailed) return <section className="card"><LoadError what="departments" onRetry={loadDepts} /></section>
  if (depts.length === 0) {
    return <section className="card"><Empty icon="staff" title="Create a department first" text="Roles belong to a department. Add one in the Departments tab." /></section>
  }

  return (
    <>
      <div className="toolbar">
        <div className="cs-select">
          <label className="sr-only" htmlFor="rl-dept">Department</label>
          <select id="rl-dept" className="a-input" value={deptId} onChange={e => setDeptId(e.target.value)}>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}{d.status !== 'Active' ? ' (archived)' : ''}</option>)}
          </select>
        </div>
        <button type="button" className="btn btn-green" onClick={() => open('new')}><Icons.add size={18} aria-hidden="true" /> Add role</button>
      </div>

      <section className="card" aria-label="Roles">
        {loading && !roles.length ? <TableSkeleton rows={4} cols={5} />
          : failed ? <LoadError what="roles" onRetry={loadRoles} />
          : roles.length === 0 ? (
            <Empty icon="staff" title={`No roles in ${dept?.name ?? 'this department'} yet`} text="A role decides which areas its people can work in."
              action={<button type="button" className="btn btn-green" onClick={() => open('new')}>Add role</button>} />
          ) : (
            <div className="tbl-wrap tbl-stack">
              <table>
                <thead>
                  <tr><th>Role</th><th>Areas</th><th>People</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {roles.map(r => (
                    <tr key={r.id}>
                      <td><span className="td-name ui-block">{r.name}</span></td>
                      <td data-label="Areas"><AreaChips areas={r.permissions} /></td>
                      <td data-label="People">{r.staffCount}</td>
                      <td data-label="Status">{r.status === 'Active' ? <span className="bdg bdg-g">Active</span> : <span className="bdg bdg-grey">Archived</span>}</td>
                      <td>
                        <div className="a-row-actions">
                          <button type="button" className="btn btn-sm btn-outline" onClick={() => open(r)}>Edit</button>
                          <button type="button" className="btn btn-sm btn-outline" onClick={() => { setActionError(''); setStatusTarget(r) }}>
                            {r.status === 'Active' ? 'Archive' : 'Reactivate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {editing && (
        <Modal error={formError || undefined} icon="staff" title={editing === 'new' ? `Add a role to ${dept?.name ?? 'department'}` : 'Edit role'} busy={busy}
          sub="Choose the areas this role can work in." onClose={() => { if (!busy) setEditing(null) }}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save role'}</button>
          </>}>
          <form onSubmit={e => { e.preventDefault(); save() }} noValidate>
            <Field id="rl-name" label="Role name" error={nameError}>
              <input id="rl-name" className="a-input" autoComplete="off" placeholder="Payout approver" value={name} aria-invalid={!!nameError}
                onChange={e => { setName(e.target.value); setNameError('') }} />
            </Field>
            <fieldset className="cs-perms">
              <legend className="a-label">Areas this role can use</legend>
              <div className="cs-area-list">
                {AREA_KEYS.map(a => (
                  <label key={a} className="cs-perm cs-area" htmlFor={`rl-area-${a}`}>
                    <input id={`rl-area-${a}`} type="checkbox" checked={areas.includes(a)}
                      onChange={() => setAreas(areas.includes(a) ? areas.filter(x => x !== a) : [...areas, a])} />
                    <span className="cs-area-text">
                      <span className="cs-area-name">
                        {AREA_LABELS[a]}
                        {MONEY_AREAS.includes(a) && <span className="cs-chip cs-chip-money">Handles money</span>}
                      </span>
                      <span className="cs-area-help">{AREA_UNLOCKS[a]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </form>
        </Modal>
      )}

      {statusTarget && (
        <ConfirmModal
          title={statusTarget.status === 'Active' ? `Archive ${statusTarget.name}?` : `Reactivate ${statusTarget.name}?`}
          body={statusTarget.status === 'Active'
            ? <>People with this role lose access to its areas until it is reactivated{statusTarget.staffCount ? ` (${statusTarget.staffCount} affected)` : ''}.</>
            : <>People with this role get its areas back.</>}
          confirmLabel={statusTarget.status === 'Active' ? 'Archive' : 'Reactivate'}
          danger={statusTarget.status === 'Active'}
          busy={busy} error={actionError}
          onConfirm={toggleStatus} onClose={() => { if (!busy) setStatusTarget(null) }}
        />
      )}
    </>
  )
}
