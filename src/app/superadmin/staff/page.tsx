'use client'

import { useState, useEffect, useCallback } from 'react'
import { Icons } from '@/components/ui/icons'
import {
  Avatar, ConfirmModal, Empty, Field, LoadError, Modal, PageHeader, Pager, RowMenu, SearchField, Segmented,
  TableSkeleton, shortDate, useToast,
} from '../_components/admin-ui'

interface StaffUser {
  id: string
  name: string
  email: string
  role: string
  permissions: string
  status: string
  lastActiveAt: string | null
  createdAt: string
}

type Filter = 'all' | 'active' | 'suspended'

const ROLES = ['Ops Manager', 'Finance', 'Support']
const ALL_PERMISSIONS = ['Agents', 'Customers', 'Transactions', 'Reports', 'Wallets', 'Commission', 'Loans']
const ROLE_TONE: Record<string, string> = {
  'Super Admin': 'bdg-p',
  'Ops Manager': 'bdg-b',
  'Finance': 'bdg-g',
  'Support': 'bdg-grey',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8
const PAGE_SIZE = 20

function parsePerms(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []
  } catch { return [] }
}

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

function RoleBadge({ role }: { role: string }) {
  return <span className={`bdg ${ROLE_TONE[role] ?? 'bdg-grey'}`}>{role}</span>
}

function PermissionPicker({ value, onChange, idPrefix }: { value: string[]; onChange: (v: string[]) => void; idPrefix: string }) {
  return (
    <fieldset className="cs-perms">
      <legend className="a-label">What they can see and manage</legend>
      <div className="cs-perms-grid">
        {ALL_PERMISSIONS.map(p => (
          <label key={p} className="cs-perm" htmlFor={`${idPrefix}-${p}`}>
            <input id={`${idPrefix}-${p}`} type="checkbox" checked={value.includes(p)}
              onChange={() => onChange(value.includes(p) ? value.filter(x => x !== p) : [...value, p])} />
            <span>{p}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

const emptyForm = { name: '', email: '', role: 'Support', permissions: [] as string[], password: '' }
type FormErrors = Partial<Record<'name' | 'email' | 'password', string>>

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [toastNode, toast] = useToast()

  // Add staff
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ ...emptyForm, permissions: [] as string[] })
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')

  // Approval PIN
  const [showPinModal, setShowPinModal] = useState(false)
  const [pinForm, setPinForm] = useState({ pin: '', currentPassword: '' })
  const [pinAgain, setPinAgain] = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const [pinError, setPinError] = useState('')

  // Edit access: edit, then confirm
  const [editTarget, setEditTarget] = useState<StaffUser | null>(null)
  const [editStep, setEditStep] = useState<'edit' | 'confirm'>('edit')
  const [editRole, setEditRole] = useState('')
  const [editPerms, setEditPerms] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Suspend / reactivate / delete
  const [statusTarget, setStatusTarget] = useState<StaffUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch('/api/admin/staff')
      if (!res.ok) throw new Error()
      const d = await res.json()
      setStaff(d.staff ?? [])
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, filter])

  function openAdd() {
    setForm({ ...emptyForm, permissions: [] }); setFormErrors({}); setFormError(''); setShowModal(true)
  }

  async function createStaff() {
    setFormError('')
    const errs: FormErrors = {}
    if (!form.name.trim()) errs.name = 'Enter their full name.'
    if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid email, like name@example.com.'
    if (form.password.length < MIN_PASSWORD) errs.password = `Use at least ${MIN_PASSWORD} characters.`
    setFormErrors(errs)
    if (Object.keys(errs).length) return
    setCreating(true)
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; staff?: { name?: string } }
      if (!res.ok) { setFormError(data.error ?? 'The account wasn’t created. Try again.'); return }
      setShowModal(false)
      setForm({ ...emptyForm, permissions: [] })
      toast(`Staff account created for ${data.staff?.name ?? form.name}`, 'success')
      load()
    } catch {
      setFormError('No connection. Check your internet and try again.')
    } finally {
      setCreating(false)
    }
  }

  async function toggleStatus() {
    const s = statusTarget
    if (!s) return
    const newStatus = s.status === 'Active' ? 'Suspended' : 'Active'
    setActionBusy(true); setActionError('')
    try {
      const res = await fetch(`/api/admin/staff/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) { setActionError(await errorOf(res, 'That didn’t go through. Try again.')); return }
      toast(`${s.name} ${newStatus === 'Active' ? 'reactivated' : 'suspended'}`, 'success')
      setStatusTarget(null)
      load()
    } catch {
      setActionError('No connection. Check your internet and try again.')
    } finally {
      setActionBusy(false)
    }
  }

  function openEdit(s: StaffUser) {
    setEditTarget(s); setEditStep('edit'); setEditRole(s.role); setEditPerms(parsePerms(s.permissions)); setEditError('')
  }

  function closeEdit() { if (!saving) setEditTarget(null) }

  async function saveEdit() {
    if (!editTarget) return
    setSaving(true); setEditError('')
    try {
      const res = await fetch(`/api/admin/staff/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: editRole, permissions: editPerms }),
      })
      if (!res.ok) { setEditError(await errorOf(res, 'The changes weren’t saved. Try again.')); return }
      toast(`${editTarget.name}’s access is updated`, 'success')
      setEditTarget(null)
      load()
    } catch {
      setEditError('No connection. Check your internet and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteStaff() {
    const s = deleteTarget
    if (!s) return
    setActionBusy(true); setActionError('')
    try {
      const res = await fetch(`/api/admin/staff/${s.id}`, { method: 'DELETE' })
      if (!res.ok) { setActionError(await errorOf(res, 'The account wasn’t deleted. Try again.')); return }
      toast(`${s.name}’s staff account is deleted`, 'success')
      setDeleteTarget(null)
      load()
    } catch {
      setActionError('No connection. Check your internet and try again.')
    } finally {
      setActionBusy(false)
    }
  }

  function openPin() {
    setPinForm({ pin: '', currentPassword: '' }); setPinAgain(''); setPinError(''); setShowPinModal(true)
  }

  function closePin() {
    if (pinLoading) return
    setShowPinModal(false); setPinForm({ pin: '', currentPassword: '' }); setPinAgain('')
  }

  async function setApprovalPin() {
    if (!pinForm.pin || pinForm.pin.length < 4) { setPinError('The PIN needs at least 4 digits.'); return }
    if (pinForm.pin !== pinAgain) { setPinError('The two PINs don’t match. Type them again.'); return }
    if (!pinForm.currentPassword) { setPinError('Enter your admin password to confirm it’s you.'); return }
    setPinLoading(true); setPinError('')
    try {
      const res = await fetch('/api/admin/set-approval-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pinForm),
      })
      if (!res.ok) { setPinError(await errorOf(res, 'The PIN wasn’t changed. Try again.')); return }
      setShowPinModal(false); setPinForm({ pin: '', currentPassword: '' }); setPinAgain('')
      toast('Approval PIN changed. Use the new PIN from now on.', 'success')
    } catch {
      setPinError('No connection. Check your internet and try again.')
    } finally {
      setPinLoading(false)
    }
  }

  const q = search.trim().toLowerCase()
  const counts = {
    all: staff.length,
    active: staff.filter(s => s.status === 'Active').length,
    suspended: staff.filter(s => s.status !== 'Active').length,
  }
  const shown = staff.filter(s =>
    (filter === 'all' || (filter === 'active' ? s.status === 'Active' : s.status !== 'Active')) &&
    (!q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)))
  const paginated = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Summary of an access change, for the confirmation step.
  const before = editTarget ? parsePerms(editTarget.permissions) : []
  const added = editPerms.filter(p => !before.includes(p))
  const removed = before.filter(p => !editPerms.includes(p))
  const roleChanged = !!editTarget && editRole !== editTarget.role
  const hasChanges = roleChanged || added.length > 0 || removed.length > 0

  return (
    <>
      <PageHeader
        title="Staff and access"
        sub={loading && !staff.length ? 'Loading…' : failed && !staff.length ? 'People who can work in this admin area.' : `${counts.all} staff account${counts.all === 1 ? '' : 's'}${counts.suspended ? ` · ${counts.suspended} suspended` : ''}`}
        actions={<>
          <button type="button" className="btn btn-outline" onClick={openPin}><Icons.locked size={18} aria-hidden="true" /> Change approval PIN</button>
          <button type="button" className="btn btn-green" onClick={openAdd}><Icons.add size={18} aria-hidden="true" /> Add staff</button>
        </>}
      />

      <p className="cs-note" role="note">
        <Icons.report size={16} aria-hidden="true" />
        <span>Staff accounts can’t sign in yet. Only the super admin account can use this area, so the roles and access set here aren’t applied anywhere for now.</span>
      </p>

      <div className="toolbar">
        <SearchField value={search} onChange={setSearch} placeholder="Name or email" label="Search staff" />
        <Segmented<Filter> label="Filter staff" value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: failed && !staff.length ? undefined : counts.all },
          { value: 'active', label: 'Active', count: failed && !staff.length ? undefined : counts.active },
          { value: 'suspended', label: 'Suspended', count: failed && !staff.length ? undefined : counts.suspended },
        ]} />
      </div>

      <section className="card" aria-label="Staff">
        {loading && !staff.length ? <TableSkeleton rows={5} cols={5} />
          : failed ? <LoadError what="staff" onRetry={load} />
          : shown.length === 0 ? (
            q ? <Empty icon="search" title={`No staff match “${search.trim()}”`} text="Check the spelling, or search by email." />
              : filter !== 'all' ? <Empty icon="check" title="Nothing here" text="No staff accounts are in this group." />
              : <Empty icon="staff" title="No staff accounts yet" text="Add a staff account for each person who helps run Vochus."
                  action={<button type="button" className="btn btn-green" onClick={openAdd}>Add staff</button>} />
          ) : (
            <>
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr>
                      <th>Staff</th><th>Role</th><th>Access</th><th>Last active</th><th>Status</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(s => {
                      const perms = parsePerms(s.permissions)
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
                          <td data-label="Role"><RoleBadge role={s.role} /></td>
                          <td data-label="Access" className="cs-perm-cell">
                            {perms.length === 0 ? <span className="cs-muted">No areas</span> : perms.join(', ')}
                          </td>
                          <td data-label="Last active">{s.lastActiveAt ? shortDate(s.lastActiveAt) : <span className="cs-muted">Never</span>}</td>
                          <td data-label="Status">
                            {active ? <span className="bdg bdg-g">Active</span> : <span className="bdg bdg-r">{s.status}</span>}
                          </td>
                          <td>
                            <div className="a-row-actions">
                              <button type="button" className="btn btn-sm btn-outline" onClick={() => openEdit(s)}>Edit access</button>
                              <RowMenu label={`More actions for ${s.name}`} items={[
                                active
                                  ? { label: 'Suspend account', danger: true, onSelect: () => { setActionError(''); setStatusTarget(s) } }
                                  : { label: 'Reactivate account', onSelect: () => { setActionError(''); setStatusTarget(s) } },
                                { label: 'Delete account', danger: true, onSelect: () => { setActionError(''); setDeleteTarget(s) } },
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

      {showModal && (
        <Modal error={formError || undefined} icon="staff" title="Add a staff member" onClose={() => setShowModal(false)} busy={creating}
          sub="Choose their role and which areas they can work in."
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)} disabled={creating}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={createStaff} disabled={creating}>{creating ? 'Creating…' : 'Create account'}</button>
          </>}>
          <form onSubmit={e => { e.preventDefault(); createStaff() }} noValidate>
            <Field id="st-name" label="Full name" error={formErrors.name}>
              <input id="st-name" className="a-input" autoComplete="off" placeholder="Jane Doe" value={form.name} aria-invalid={!!formErrors.name}
                onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setFormErrors(x => ({ ...x, name: undefined })) }} />
            </Field>
            <Field id="st-email" label="Work email" error={formErrors.email}>
              <input id="st-email" className="a-input" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false}
                placeholder="jane@vochus.com" value={form.email} aria-invalid={!!formErrors.email}
                onChange={e => { setForm(f => ({ ...f, email: e.target.value })); setFormErrors(x => ({ ...x, email: undefined })) }} />
            </Field>
            <Field id="st-role" label="Role">
              <select id="st-role" className="a-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <PermissionPicker idPrefix="st-new" value={form.permissions} onChange={permissions => setForm(f => ({ ...f, permissions }))} />
            <Field id="st-pass" label="Temporary password" error={formErrors.password}
              hint={`At least ${MIN_PASSWORD} characters. Share it with them privately. It can’t be shown again.`}>
              <input id="st-pass" className="a-input" type="password" autoComplete="new-password" value={form.password} aria-invalid={!!formErrors.password}
                onChange={e => { setForm(f => ({ ...f, password: e.target.value })); setFormErrors(x => ({ ...x, password: undefined })) }} />
            </Field>
          </form>
        </Modal>
      )}

      {showPinModal && (
        <Modal error={pinError || undefined} icon="locked" title="Change approval PIN" onClose={closePin} busy={pinLoading}
          sub="You need this PIN to approve or reject redemptions and agent withdrawals."
          footer={<>
            <button type="button" className="btn btn-outline" onClick={closePin} disabled={pinLoading}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={setApprovalPin} disabled={pinLoading}>{pinLoading ? 'Saving…' : 'Save PIN'}</button>
          </>}>
          <form onSubmit={e => { e.preventDefault(); setApprovalPin() }} noValidate>
            <Field id="pin-new" label="New PIN" hint="At least 4 digits.">
              <input id="pin-new" className="a-input cs-pin" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={12}
                value={pinForm.pin} onChange={e => { setPinForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') })); setPinError('') }} />
            </Field>
            <Field id="pin-again" label="Type the new PIN again">
              <input id="pin-again" className="a-input cs-pin" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={12}
                value={pinAgain} onChange={e => { setPinAgain(e.target.value.replace(/\D/g, '')); setPinError('') }} />
            </Field>
            <Field id="pin-pass" label="Your admin password" hint="To confirm it’s you.">
              <input id="pin-pass" className="a-input" type="password" autoComplete="current-password"
                value={pinForm.currentPassword} onChange={e => { setPinForm(f => ({ ...f, currentPassword: e.target.value })); setPinError('') }} />
            </Field>
          </form>
        </Modal>
      )}

      {editTarget && editStep === 'edit' && (
        <Modal icon="staff" title={`Edit access for ${editTarget.name}`} sub={editTarget.email} onClose={closeEdit}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={closeEdit}>Cancel</button>
            <button type="button" className="btn btn-green" disabled={!hasChanges} onClick={() => { setEditError(''); setEditStep('confirm') }}>Review changes</button>
          </>}>
          <Field id="ed-role" label="Role">
            <select id="ed-role" className="a-input" value={editRole} onChange={e => setEditRole(e.target.value)}>
              {!ROLES.includes(editTarget.role) && <option value={editTarget.role}>{editTarget.role}</option>}
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <PermissionPicker idPrefix="ed" value={editPerms} onChange={setEditPerms} />
          {!hasChanges && <p className="a-hint">Change the role or an area to save.</p>}
        </Modal>
      )}

      {editTarget && editStep === 'confirm' && (
        <ConfirmModal icon="staff"
          title={`Change ${editTarget.name}’s access?`}
          body={<>
            <ul className="cs-changes">
              {roleChanged && <li>Role: <strong>{editTarget.role}</strong> to <strong>{editRole}</strong></li>}
              {added.length > 0 && <li>Can now use: <strong>{added.join(', ')}</strong></li>}
              {removed.length > 0 && <li>Loses: <strong>{removed.join(', ')}</strong></li>}
            </ul>
            <p className="dlg-note">This is recorded in the audit log.</p>
          </>}
          confirmLabel="Save changes"
          danger={removed.length > 0}
          busy={saving} error={editError}
          onConfirm={saveEdit} onClose={() => { if (!saving) setEditStep('edit') }}
        />
      )}

      {statusTarget && (
        <ConfirmModal
          title={statusTarget.status === 'Active' ? `Suspend ${statusTarget.name}?` : `Reactivate ${statusTarget.name}?`}
          body={statusTarget.status === 'Active'
            ? <>{statusTarget.email} will be marked suspended. Their role and access settings are kept, so you can reactivate them later.</>
            : <>{statusTarget.email} will be marked active again with the access they had before.</>}
          confirmLabel={statusTarget.status === 'Active' ? 'Suspend account' : 'Reactivate account'}
          danger={statusTarget.status === 'Active'}
          busy={actionBusy} error={actionError}
          onConfirm={toggleStatus} onClose={() => { if (!actionBusy) setStatusTarget(null) }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Delete ${deleteTarget.name}’s account?`}
          body={<>This permanently removes the staff account for <strong>{deleteTarget.email}</strong> ({deleteTarget.role}). You can’t undo this. To stop access for a while instead, suspend the account.</>}
          confirmLabel="Delete account" danger
          busy={actionBusy} error={actionError}
          onConfirm={deleteStaff} onClose={() => { if (!actionBusy) setDeleteTarget(null) }}
        />
      )}

      {toastNode}
    </>
  )
}
