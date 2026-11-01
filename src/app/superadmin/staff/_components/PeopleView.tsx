'use client'

import { useState, useEffect, useCallback } from 'react'
import { Icons } from '@/components/ui/icons'
import {
  Avatar, ConfirmModal, Empty, Field, LoadError, Modal, Pager, RowMenu, SearchField, TableSkeleton, shortDate,
} from '../../_components/admin-ui'
import { type RoleRow, errorOf, sendJson } from './shared'

interface StaffUser {
  id: string
  name: string
  email: string
  status: string
  lastActiveAt: string | null
  hasApprovalPin: boolean
  role: { id: string; name: string; department: { id: string; name: string } } | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8
const PAGE_SIZE = 20
type FormErrors = Partial<Record<'name' | 'email' | 'password', string>>

function RoleSelect({ id, value, onChange, roles }: { id: string; value: string; onChange: (v: string) => void; roles: RoleRow[] }) {
  const groups = new Map<string, RoleRow[]>()
  for (const r of roles) groups.set(r.department.name, [...(groups.get(r.department.name) ?? []), r])
  return (
    <select id={id} className="a-input" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">No role (no access)</option>
      {[...groups.entries()].map(([dn, rs]) => (
        <optgroup key={dn} label={dn}>
          {rs.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

export default function PeopleView({ toast }: { toast: (m: string, t?: 'success' | 'error') => void }) {
  const [staff, setStaff] = useState<StaffUser[]>([])
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [rolesFailed, setRolesFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', roleId: '' })
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const [roleTarget, setRoleTarget] = useState<StaffUser | null>(null)
  const [roleChoice, setRoleChoice] = useState('')
  const [statusTarget, setStatusTarget] = useState<StaffUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false); setRolesFailed(false)
    try {
      const res = await fetch('/api/admin/staff')
      if (!res.ok) throw new Error()
      const d = await res.json()
      setStaff(d.staff ?? [])
    } catch { setFailed(true) } finally { setLoading(false) }
    try {
      const res = await fetch('/api/admin/roles')
      if (!res.ok) throw new Error()
      const d = await res.json()
      setRoles((d.roles as RoleRow[] ?? []).filter(r => r.status === 'Active'))
    } catch { setRolesFailed(true) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search])

  function openAdd() {
    setForm({ name: '', email: '', password: '', roleId: '' }); setFormErrors({}); setFormError(''); setShowAdd(true)
  }

  async function createStaff() {
    const errs: FormErrors = {}
    if (!form.name.trim()) errs.name = 'Enter their full name.'
    if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid email, like name@example.com.'
    if (form.password.length < MIN_PASSWORD) errs.password = `Use at least ${MIN_PASSWORD} characters.`
    setFormErrors(errs); setFormError('')
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), password: form.password, roleId: form.roleId || null }),
      })
      if (!res.ok) {
        setFormError(res.status === 409 ? await errorOf(res, 'That email is already in use by another account.') : await errorOf(res, 'The account wasn’t created. Try again.'))
        return
      }
      setShowAdd(false)
      toast(`Staff login created for ${form.name.trim()}`, 'success')
      load()
    } catch { setFormError('No connection. Check your internet and try again.') } finally { setBusy(false) }
  }

  async function run(url: string, method: 'PATCH' | 'DELETE', body: unknown, okMsg: string, close: () => void) {
    setBusy(true); setActionError('')
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      if (!res.ok) { setActionError(await errorOf(res, 'That didn’t go through. Try again.')); return }
      toast(okMsg, 'success'); close(); load()
    } catch { setActionError('No connection. Check your internet and try again.') } finally { setBusy(false) }
  }

  const q = search.trim().toLowerCase()
  const shown = staff.filter(s => !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
  const paginated = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Name or email" label="Search people" />
        <button type="button" className="btn btn-green" onClick={openAdd}><Icons.add size={18} aria-hidden="true" /> Add person</button>
      </div>

      <section className="card" aria-label="People">
        {loading && !staff.length ? <TableSkeleton rows={5} cols={5} />
          : failed ? <LoadError what="people" onRetry={load} />
          : shown.length === 0 ? (
            q ? <Empty icon="search" title={`No one matches “${search.trim()}”`} text="Check the spelling, or search by email." />
              : <Empty icon="staff" title="No staff logins yet" text="Add a login for each person who helps run Vochus, then give them a role."
                  action={<button type="button" className="btn btn-green" onClick={openAdd}>Add person</button>} />
          ) : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr><th>Person</th><th>Role</th><th>Approval PIN</th><th>Last active</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {paginated.map(s => {
                      const active = s.status === 'Active'
                      return (
                        <tr key={s.id}>
                          <td>
                            <div className="td-av">
                              <Avatar name={s.name} tone={active ? 'green' : 'grey'} />
                              <span>
                                <span className="td-name ui-block">{s.name}</span>
                                <span className="td-sub ui-block">{s.email}</span>
                              </span>
                            </div>
                          </td>
                          <td data-label="Role">
                            {s.role ? `${s.role.department.name} · ${s.role.name}` : <span className="cs-muted">No role — no access</span>}
                          </td>
                          <td data-label="Approval PIN">
                            {s.hasApprovalPin ? <span className="bdg bdg-g">PIN set</span> : <span className="bdg bdg-grey">No PIN</span>}
                          </td>
                          <td data-label="Last active">{s.lastActiveAt ? shortDate(s.lastActiveAt) : <span className="cs-muted">Never</span>}</td>
                          <td data-label="Status">{active ? <span className="bdg bdg-g">Active</span> : <span className="bdg bdg-r">{s.status}</span>}</td>
                          <td>
                            <div className="a-row-actions">
                              <button type="button" className="btn btn-sm btn-outline" onClick={() => { setActionError(''); setRoleChoice(s.role?.id ?? ''); setRoleTarget(s) }}>Change role</button>
                              <RowMenu label={`More actions for ${s.name}`} items={[
                                active
                                  ? { label: 'Suspend login', danger: true, onSelect: () => { setActionError(''); setStatusTarget(s) } }
                                  : { label: 'Reactivate login', onSelect: () => { setActionError(''); setStatusTarget(s) } },
                                { label: 'Remove login', danger: true, onSelect: () => { setActionError(''); setDeleteTarget(s) } },
                              ]} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={page} pageSize={PAGE_SIZE} total={shown.length} onPage={setPage} />
            </>
          )}
      </section>

      {showAdd && (
        <Modal error={formError || undefined} icon="staff" title="Add a staff login" busy={busy} onClose={() => { if (!busy) setShowAdd(false) }}
          sub="They sign in at the admin login and see only their role’s areas."
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setShowAdd(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={createStaff} disabled={busy}>{busy ? 'Creating…' : 'Create login'}</button>
          </>}>
          <form onSubmit={e => { e.preventDefault(); createStaff() }} noValidate>
            <Field id="pp-name" label="Full name" error={formErrors.name}>
              <input id="pp-name" className="a-input" autoComplete="off" placeholder="Jane Doe" value={form.name} aria-invalid={!!formErrors.name}
                onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setFormErrors(x => ({ ...x, name: undefined })) }} />
            </Field>
            <Field id="pp-email" label="Work email" error={formErrors.email}>
              <input id="pp-email" className="a-input" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false}
                placeholder="jane@vochus.com" value={form.email} aria-invalid={!!formErrors.email}
                onChange={e => { setForm(f => ({ ...f, email: e.target.value })); setFormErrors(x => ({ ...x, email: undefined })) }} />
            </Field>
            <Field id="pp-role" label="Role" hint={rolesFailed ? 'Roles couldn’t be loaded. You can assign one later.' : roles.length === 0 ? 'No active roles yet. You can assign one later.' : 'Leave empty to give no access yet.'}>
              <RoleSelect id="pp-role" value={form.roleId} roles={roles} onChange={roleId => setForm(f => ({ ...f, roleId }))} />
            </Field>
            <Field id="pp-pass" label="Temporary password" error={formErrors.password}
              hint={`At least ${MIN_PASSWORD} characters. Share it with them privately. It can’t be shown again.`}>
              <input id="pp-pass" className="a-input" type="password" autoComplete="new-password" value={form.password} aria-invalid={!!formErrors.password}
                onChange={e => { setForm(f => ({ ...f, password: e.target.value })); setFormErrors(x => ({ ...x, password: undefined })) }} />
            </Field>
          </form>
        </Modal>
      )}

      {roleTarget && (
        <Modal icon="staff" title={`Change role for ${roleTarget.name}`} sub={roleTarget.email} busy={busy} error={actionError || undefined}
          onClose={() => { if (!busy) setRoleTarget(null) }}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setRoleTarget(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-green" disabled={busy || roleChoice === (roleTarget.role?.id ?? '')}
              onClick={() => run(`/api/admin/staff/${roleTarget.id}`, 'PATCH', { roleId: roleChoice || null }, `${roleTarget.name}’s role is updated`, () => setRoleTarget(null))}>
              {busy ? 'Saving…' : 'Save role'}
            </button>
          </>}>
          <Field id="pp-rolechange" label="Role" hint={rolesFailed ? 'Roles couldn’t be loaded.' : 'Choosing “No role” removes all access.'}>
            <RoleSelect id="pp-rolechange" value={roleChoice} roles={roles} onChange={setRoleChoice} />
          </Field>
        </Modal>
      )}

      {statusTarget && (
        <ConfirmModal
          title={statusTarget.status === 'Active' ? `Suspend ${statusTarget.name}?` : `Reactivate ${statusTarget.name}?`}
          body={statusTarget.status === 'Active'
            ? <>{statusTarget.email} can’t sign in while suspended. Their role is kept, so you can reactivate them later.</>
            : <>{statusTarget.email} can sign in again with their current role.</>}
          confirmLabel={statusTarget.status === 'Active' ? 'Suspend login' : 'Reactivate login'}
          danger={statusTarget.status === 'Active'}
          busy={busy} error={actionError}
          onConfirm={() => run(`/api/admin/staff/${statusTarget.id}`, 'PATCH', { status: statusTarget.status === 'Active' ? 'Suspended' : 'Active' },
            `${statusTarget.name} ${statusTarget.status === 'Active' ? 'suspended' : 'reactivated'}`, () => setStatusTarget(null))}
          onClose={() => { if (!busy) setStatusTarget(null) }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Remove ${deleteTarget.name}’s login?`}
          body={<>This permanently removes the staff login for <strong>{deleteTarget.email}</strong>. You can’t undo this. To stop access for a while instead, suspend the login.</>}
          confirmLabel="Remove login" danger
          busy={busy} error={actionError}
          onConfirm={() => run(`/api/admin/staff/${deleteTarget.id}`, 'DELETE', null, `${deleteTarget.name}’s login is removed`, () => setDeleteTarget(null))}
          onClose={() => { if (!busy) setDeleteTarget(null) }}
        />
      )}
    </>
  )
}
