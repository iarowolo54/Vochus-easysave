'use client'

import { useState } from 'react'
import { Field, Modal } from '../../_components/admin-ui'
import { canGrant, type Perm } from '@/lib/permissions'
import PermChips from './PermChips'
import { NO_CONNECTION, errorOf, sendJson, type Department, type InviteLink, type RoleRow, type StaffUser, type Toast } from './shared'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

function DepartmentSelect({ id, value, onChange, departments, currentId }: { id: string; value: string; onChange: (v: string) => void; departments: Department[]; currentId?: string }) {
  return (
    <select id={id} className="a-input" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">No department</option>
      {departments.filter(d => d.status === 'Active' || d.id === currentId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  )
}

const rolesFor = (roles: RoleRow[], departmentId: string) => roles.filter(r => r.status === 'Active' && (!departmentId || r.department.id === departmentId))

export function AddPersonModal({ roles, departments, isOwner, ceiling, toast, onClose, onDone, onInviteLink }: {
  roles: RoleRow[]; departments: Department[]; isOwner: boolean; ceiling: Perm[] | null
  toast: Toast; onClose: () => void; onDone: () => void; onInviteLink: (l: InviteLink) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [roleId, setRoleId] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const choices = rolesFor(roles, departmentId)

  function pickRole(id: string) {
    setRoleId(id)
    const r = roles.find(x => x.id === id)
    if (r) setDepartmentId(r.department.id)
  }

  async function submit() {
    const errs: typeof errors = {}
    if (!name.trim()) errs.name = 'Enter their full name.'
    if (!EMAIL_RE.test(email.trim())) errs.email = 'Enter a valid email, like name@example.com.'
    setErrors(errs); setFormError('')
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), roleId: roleId || null, ...(isOwner && departmentId ? { departmentId } : {}) }),
      })
      if (!res.ok) {
        setFormError(await errorOf(res, res.status === 409 ? 'That email is already in use by another account.' : 'The account wasn’t created. Try again.'))
        return
      }
      const created: { link?: string; emailed?: boolean } = await res.json().catch(() => ({}))
      if (created.link) onInviteLink({ name: name.trim(), link: created.link })
      else toast(created.emailed ? `Invite emailed to ${email.trim()}` : `Invite created for ${name.trim()}`, 'success')
      onDone()
      onClose()
    } catch { setFormError(NO_CONNECTION) } finally { setBusy(false) }
  }

  return (
    <Modal error={formError || undefined} icon="staff" title="Invite a person" busy={busy} onClose={() => { if (!busy) onClose() }}
      sub="They get an email to set their own password. The link works once and expires in 48 hours."
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-green" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button>
      </>}>
      <form onSubmit={e => { e.preventDefault(); submit() }} noValidate>
        <Field id="pp-name" label="Full name" error={errors.name}>
          <input id="pp-name" className="a-input" autoComplete="off" placeholder="Jane Doe" value={name} aria-invalid={!!errors.name}
            onChange={e => { setName(e.target.value); setErrors(x => ({ ...x, name: undefined })) }} />
        </Field>
        <Field id="pp-email" label="Work email" error={errors.email}>
          <input id="pp-email" className="a-input" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false}
            placeholder="jane@vochus.com" value={email} aria-invalid={!!errors.email}
            onChange={e => { setEmail(e.target.value); setErrors(x => ({ ...x, email: undefined })) }} />
        </Field>
        {isOwner && (
          <Field id="pp-dept" label="Department">
            <DepartmentSelect id="pp-dept" value={departmentId} departments={departments} onChange={v => { setDepartmentId(v); setRoleId('') }} />
          </Field>
        )}
        <Field id="pp-role" label="Role" hint={choices.length === 0 ? 'No active roles here yet. You can assign one later.' : undefined}>
          <RoleSelect id="pp-role" value={roleId} roles={choices} ceiling={ceiling} onChange={pickRole} />
        </Field>
      </form>
    </Modal>
  )
}

export type PersonAction = 'status' | 'remove' | 'resend'

export function ManagePersonModal({ person, roles, departments, isOwner, ceiling, toast, onClose, onDone, onAction }: {
  person: StaffUser; roles: RoleRow[]; departments: Department[]; isOwner: boolean; ceiling: Perm[] | null
  toast: Toast; onClose: () => void; onDone: () => void; onAction: (a: PersonAction) => void
}) {
  const startDept = person.department?.id ?? ''
  const startRole = person.role?.id ?? ''
  const [departmentId, setDepartmentId] = useState(startDept)
  const [roleId, setRoleId] = useState(startRole)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const choices = rolesFor(roles, departmentId)
  const chosen = roles.find(r => r.id === roleId)
  const changed = departmentId !== startDept || roleId !== startRole

  function pickRole(id: string) {
    setRoleId(id)
    const r = roles.find(x => x.id === id)
    if (r) setDepartmentId(r.department.id)
  }

  async function save() {
    setBusy(true); setError('')
    const r = await sendJson(`/api/admin/staff/${person.id}`, 'PATCH', {
      ...(isOwner && departmentId !== startDept ? { departmentId: departmentId || null } : {}),
      ...(roleId !== startRole ? { roleId: roleId || null } : {}),
    })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    toast(`${person.name} is updated`, 'success')
    onDone(); onClose()
  }

  return (
    <Modal icon="staff" title={person.name} sub={person.email} busy={busy} error={error || undefined} onClose={() => { if (!busy) onClose() }}
      footer={<>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-green" onClick={save} disabled={busy || !changed}>{busy ? 'Saving…' : 'Save changes'}</button>
      </>}>
      {isOwner && (
        <Field id="mp-dept" label="Department">
          <DepartmentSelect id="mp-dept" value={departmentId} departments={departments} currentId={startDept}
            onChange={v => { setDepartmentId(v); setRoleId('') }} />
        </Field>
      )}
      <Field id="mp-role" label="Role">
        <RoleSelect id="mp-role" value={roleId} roles={choices} ceiling={ceiling} onChange={pickRole} />
      </Field>
      <div className="um-section">
        <div className="um-section-title">Access</div>
        <PermChips perms={chosen?.permissions ?? []} />
      </div>
      <div className="um-section">
        <div className="um-section-title">Account</div>
        <div className="um-actions">
          {person.status === 'Invited' && <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={() => onAction('resend')}>Resend invite</button>}
          {person.status !== 'Invited' && (
            <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={() => onAction('status')}>
              {person.status === 'Active' ? 'Suspend login' : 'Reactivate login'}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-outline um-danger" disabled={busy} onClick={() => onAction('remove')}>Remove login</button>
        </div>
      </div>
    </Modal>
  )
}
