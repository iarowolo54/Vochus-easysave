'use client'

import { useState, useEffect, useCallback } from 'react'
import { Icons } from '@/components/ui/icons'
import {
  Avatar, ConfirmModal, Empty, Field, LoadError, Modal, Pager, RowMenu, SearchField, TableSkeleton, shortDate,
} from '../../_components/admin-ui'
import { canGrant, type Perm } from '@/lib/permissions'
import { type RoleRow, type StaffUser, errorOf } from './shared'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAGE_SIZE = 20
type FormErrors = Partial<Record<'name' | 'email', string>>

function RoleSelect({ id, value, onChange, roles, ceiling }: { id: string; value: string; onChange: (v: string) => void; roles: RoleRow[]; ceiling: Perm[] | null }) {
  const groups = new Map<string, RoleRow[]>()
  for (const r of roles) groups.set(r.department.name, [...(groups.get(r.department.name) ?? []), r])
  return (
    <select id={id} className="a-input" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">No role (no access)</option>
      {[...groups.entries()].map(([dn, rs]) => (
        <optgroup key={dn} label={dn}>
          {rs.map(r => {
            const beyond = !!ceiling && !canGrant(ceiling, r.permissions as Perm[])
            return <option key={r.id} value={r.id} disabled={beyond}>{r.name}{beyond ? ' (above your access)' : ''}</option>
          })}
        </optgroup>
      ))}
    </select>
  )
}

export default function PeopleView({ toast, departmentId, isOwner, ceiling, onChanged }: {
  toast: (m: string, t?: 'success' | 'error') => void
  /** Set inside a department hub (and for a lead): only that department's people and roles. */
  departmentId?: string
  isOwner: boolean
  ceiling: Perm[] | null
  onChanged?: () => void
}) {
  const [staff, setStaff] = useState<StaffUser[]>([])
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [rolesFailed, setRolesFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', roleId: '' })
  const [inviteLink, setInviteLink] = useState<{ name: string; link: string } | null>(null)
  const [copied, setCopied] = useState(false)
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
      const all: StaffUser[] = d.staff ?? []
      setStaff(departmentId ? all.filter(x => x.department?.id === departmentId) : all)
    } catch { setFailed(true) } finally { setLoading(false) }
    try {
      const res = await fetch(departmentId ? `/api/admin/roles?departmentId=${encodeURIComponent(departmentId)}` : '/api/admin/roles')
      if (!res.ok) throw new Error()
      const d = await res.json()
      setRoles((d.roles as RoleRow[] ?? []).filter(r => r.status === 'Active'))
    } catch { setRolesFailed(true) }
  }, [departmentId])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search])

  function openAdd() {
    setForm({ name: '', email: '', roleId: '' }); setFormErrors({}); setFormError(''); setShowAdd(true)
  }

  async function createStaff() {
    const errs: FormErrors = {}
    if (!form.name.trim()) errs.name = 'Enter their full name.'
    if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid email, like name@example.com.'
    setFormErrors(errs); setFormError('')
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), roleId: form.roleId || null, ...(departmentId ? { departmentId } : {}) }),
      })
      if (!res.ok) {
        setFormError(res.status === 409 ? await errorOf(res, 'That email is already in use by another account.') : await errorOf(res, 'The account wasn’t created. Try again.'))
        return
      }
      const created: { link?: string; emailed?: boolean } = await res.json().catch(() => ({}))
      setShowAdd(false)
      if (created.link) { setCopied(false); setInviteLink({ name: form.name.trim(), link: created.link }) }
      else toast(created.emailed ? `Invite emailed to ${form.email.trim()}` : `Invite created for ${form.name.trim()}`, 'success')
      load(); onChanged?.()
    } catch { setFormError('No connection. Check your internet and try again.') } finally { setBusy(false) }
  }

  async function run(url: string, method: 'PATCH' | 'DELETE', body: unknown, okMsg: string, close: () => void) {
    setBusy(true); setActionError('')
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      if (!res.ok) { setActionError(await errorOf(res, 'That didn’t go through. Try again.')); return }
      toast(okMsg, 'success'); close(); load(); onChanged?.()
    } catch { setActionError('No connection. Check your internet and try again.') } finally { setBusy(false) }
  }

  async function resend(s: StaffUser) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/staff/${s.id}/resend-invite`, { method: 'POST' })
      if (!res.ok) { toast(await errorOf(res, 'The invite wasn’t sent. Try again.'), 'error'); return }
      const d: { link?: string; emailed?: boolean } = await res.json().catch(() => ({}))
      if (d.link) { setCopied(false); setInviteLink({ name: s.name, link: d.link }) }
      else toast(`New invite sent to ${s.email}. The old link no longer works.`, 'success')
    } catch { toast('No connection. Check your internet and try again.', 'error') } finally { setBusy(false) }
  }

  async function copyLink() {
    if (!inviteLink) return
    try { await navigator.clipboard.writeText(inviteLink.link); setCopied(true) } catch { setCopied(false) }
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
                    <tr><th>Person</th><th>Department · role</th><th>Approval PIN</th><th>Last active</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
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
                            {s.role ? `${s.department?.name ?? 'No department'} · ${s.role.name}` : <span className="cs-muted">No role — no access</span>}
                            {s.isLead && <span className="cs-chip">Lead</span>}
                          </td>
                          <td data-label="Approval PIN">
                            {s.hasApprovalPin ? <span className="bdg bdg-g">PIN set</span> : <span className="bdg bdg-grey">No PIN</span>}
                          </td>
                          <td data-label="Last active">{s.lastActiveAt ? shortDate(s.lastActiveAt) : <span className="cs-muted">Never</span>}</td>
                          <td data-label="Status">{active ? <span className="bdg bdg-g">Active</span> : s.status === 'Invited' ? <span className="bdg bdg-grey">Invited</span> : <span className="bdg bdg-r">{s.status}</span>}</td>
                          <td>
                            <div className="a-row-actions">
                              <button type="button" className="btn btn-sm btn-outline" onClick={() => { setActionError(''); setRoleChoice(s.role?.id ?? ''); setRoleTarget(s) }}>Change role</button>
                              <RowMenu label={`More actions for ${s.name}`} items={[
                                s.status === 'Invited' && { label: 'Resend invite', onSelect: () => { resend(s) } },
                                s.status !== 'Invited' && (active
                                  ? { label: 'Suspend login', danger: true, onSelect: () => { setActionError(''); setStatusTarget(s) } }
                                  : { label: 'Reactivate login', onSelect: () => { setActionError(''); setStatusTarget(s) } }),
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
        <Modal error={formError || undefined} icon="staff" title="Invite a person" busy={busy} onClose={() => { if (!busy) setShowAdd(false) }}
          sub="They sign in at the admin login and see only what their role allows."
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setShowAdd(false)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={createStaff} disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button>
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
              <RoleSelect id="pp-role" value={form.roleId} roles={roles} ceiling={ceiling} onChange={roleId => setForm(f => ({ ...f, roleId }))} />
            </Field>
            <p className="a-hint">They get an email with a link to set their own password. The link works once and expires in 48 hours.</p>
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
            <RoleSelect id="pp-rolechange" value={roleChoice} ceiling={ceiling} onChange={setRoleChoice}
              roles={roleTarget.department ? roles.filter(r => r.department.id === roleTarget.department?.id) : roles} />
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

      {inviteLink && (
        <Modal icon="staff" title={`Invite for ${inviteLink.name}`} onClose={() => setInviteLink(null)}
          sub="An email is sent in production. Copy this link if you need to share it yourself. It works once and won’t be shown again."
          footer={<>
            <button type="button" className="btn btn-outline" onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
            <button type="button" className="btn btn-green" onClick={() => setInviteLink(null)}>Done</button>
          </>}>
          <p className="cs-linkbox">{inviteLink.link}</p>
        </Modal>
      )}
    </>
  )
}
