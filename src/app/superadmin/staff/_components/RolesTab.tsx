'use client'

import { useMemo, useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { ConfirmModal, Empty, Field, Modal } from '../../_components/admin-ui'
import { SCREENS, canEditRole, canGrant, type Perm } from '@/lib/permissions'
import PermissionMatrix, { ACCESS_GROUPS, permsOf } from './PermissionMatrix'
import { downloadCsv, sendJson, type StaffData, type RoleRow, type Toast } from './shared'

const screenCount = (perms: readonly string[]) => new Set(perms.map(p => p.split(':')[0])).size
const samePerms = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(p => b.includes(p))

type RoleForm = { mode: 'add' | 'duplicate' | 'rename'; name: string; departmentId: string; copyFrom: string }
const LIST = '__list'

export default function RolesTab({ data, isOwner, ceiling, toast, reload }: {
  data: StaffData
  isOwner: boolean
  ceiling: Perm[] | null
  toast: Toast
  reload: () => Promise<void>
}) {
  const { roles, departments } = data
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  // Unsaved edits to the selected role; null means none.
  const [draft, setDraft] = useState<Perm[] | null>(null)
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set([ACCESS_GROUPS[0]]))
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null)

  const [form, setForm] = useState<RoleForm | null>(null)
  const [nameError, setNameError] = useState('')
  const [formError, setFormError] = useState('')
  const [statusTarget, setStatusTarget] = useState<RoleRow | null>(null)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)

  const grouped = useMemo(() => {
    const m = new Map<string, RoleRow[]>()
    for (const r of roles) m.set(r.department.name, [...(m.get(r.department.name) ?? []), r])
    return [...m.entries()]
  }, [roles])

  const selected = roles.find(r => r.id === selectedId) ?? roles[0] ?? null
  const saved = (selected?.permissions ?? []) as Perm[]
  const current = draft ?? saved
  const dirty = draft !== null && !samePerms(draft, saved)
  const editable = !!selected && (!ceiling || canGrant(ceiling, saved))
  const activeDepartments = departments.filter(d => d.status === 'Active')
  const allOpen = openGroups.size === ACCESS_GROUPS.length

  function selectNow(id: string) {
    if (id === LIST) setShowDetail(false)
    else { setSelectedId(id); setShowDetail(true) }
    setDraft(null); setPendingSwitch(null)
  }

  function trySelect(id: string) {
    if (dirty && (id === LIST || id !== selected?.id)) setPendingSwitch(id)
    else if (id === LIST) setShowDetail(false)
    else selectNow(id)
  }

  function toggleGroup(g: string) {
    setOpenGroups(prev => { const n = new Set(prev); if (!n.delete(g)) n.add(g); return n })
  }

  function setAll(on: boolean) {
    const grantable = permsOf(SCREENS, ceiling)
    setDraft(on ? [...new Set([...current, ...grantable])] : current.filter(p => !grantable.includes(p)))
  }

  async function saveAccess() {
    if (!selected || !draft) return
    if (ceiling && !canEditRole(ceiling, saved, draft)) { toast('You can only give a role access you hold yourself.', 'error'); return }
    setBusy(true)
    const r = await sendJson(`/api/admin/roles/${selected.id}`, 'PATCH', { permissions: draft })
    setBusy(false)
    if (!r.ok) { toast(r.error, 'error'); return }
    toast(`${selected.name} is saved`, 'success')
    await reload()
    setDraft(null)
  }

  function openForm(mode: RoleForm['mode']) {
    setNameError(''); setFormError('')
    const fallbackDept = activeDepartments[0]?.id ?? ''
    setForm({
      mode,
      name: mode === 'rename' ? selected?.name ?? '' : mode === 'duplicate' ? `${selected?.name ?? ''} (copy)` : '',
      departmentId: mode === 'add' ? fallbackDept : selected?.department.id ?? fallbackDept,
      copyFrom: '',
    })
  }

  async function submitForm() {
    if (!form) return
    const name = form.name.trim()
    if (!name) { setNameError('Enter a role name.'); return }
    if (form.mode !== 'rename' && !form.departmentId) { setFormError('Add a department first.'); return }
    setBusy(true); setFormError('')
    const source = form.mode === 'duplicate' ? saved : (roles.find(r => r.id === form.copyFrom)?.permissions ?? [])
    const r = form.mode === 'rename' && selected
      ? await sendJson(`/api/admin/roles/${selected.id}`, 'PATCH', { name })
      : await sendJson('/api/admin/roles', 'POST', { name, departmentId: form.departmentId, permissions: source })
    setBusy(false)
    if (!r.ok) { setFormError(r.error); return }
    toast(form.mode === 'rename' ? 'Role renamed' : `${name} role created`, 'success')
    setForm(null)
    await reload()
    const createdId = (r.data as { role?: { id?: string } } | null)?.role?.id
    if (form.mode !== 'rename' && createdId) selectNow(createdId)
  }

  async function toggleStatus() {
    const t = statusTarget
    if (!t) return
    const next = t.status === 'Active' ? 'Archived' : 'Active'
    setBusy(true); setActionError('')
    const r = await sendJson(`/api/admin/roles/${t.id}`, 'PATCH', { status: next })
    setBusy(false)
    if (!r.ok) { setActionError(r.error); return }
    toast(`${t.name} ${next === 'Active' ? 'reactivated' : 'archived'}`, 'success')
    setStatusTarget(null); reload()
  }

  function exportRole() {
    if (!selected) return
    downloadCsv(`role-${selected.name.replace(/\s+/g, '-').toLowerCase()}.csv`, [
      ['Area', 'Screen', 'View', 'Manage'],
      ...SCREENS.map(s => [s.group, s.label, saved.includes(`${s.key}:view` as Perm) ? 'Yes' : 'No', saved.includes(`${s.key}:manage` as Perm) ? 'Yes' : 'No']),
    ])
  }

  const addButton = <button type="button" className="btn btn-sm btn-green" disabled={dirty || activeDepartments.length === 0} onClick={() => openForm('add')}><Icons.add size={16} aria-hidden="true" /> Add role</button>

  if (roles.length === 0) {
    return (
      <>
        <section className="card">
          <Empty icon="staff" title="No roles yet"
            text={activeDepartments.length === 0 ? 'Add a department first. Roles belong to a department.' : 'A role decides which screens its people can view and manage.'}
            action={addButton} />
        </section>
        {form && renderForm()}
      </>
    )
  }

  function renderForm() {
    if (!form) return null
    const title = form.mode === 'add' ? 'Add a role' : form.mode === 'duplicate' ? `Duplicate ${selected?.name}` : 'Rename role'
    return (
      <Modal error={formError || undefined} icon="staff" title={title} busy={busy} onClose={() => { if (!busy) setForm(null) }}
        footer={<>
          <button type="button" className="btn btn-outline" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-green" onClick={submitForm} disabled={busy}>{busy ? 'Saving…' : form.mode === 'rename' ? 'Save' : 'Create role'}</button>
        </>}>
        <form onSubmit={e => { e.preventDefault(); submitForm() }} noValidate>
          <Field id="rl-name" label="Role name" error={nameError}>
            <input id="rl-name" className="a-input" autoComplete="off" placeholder="Payout approver" value={form.name} aria-invalid={!!nameError}
              onChange={e => { setForm({ ...form, name: e.target.value }); setNameError('') }} />
          </Field>
          {isOwner && form.mode !== 'rename' && (
            <Field id="rl-dept" label="Department">
              <select id="rl-dept" className="a-input" value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value })}>
                {activeDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          )}
          {form.mode === 'add' && (
            <Field id="rl-copy" label="Copy access from">
              <select id="rl-copy" className="a-input" value={form.copyFrom} onChange={e => setForm({ ...form, copyFrom: e.target.value })}>
                <option value="">Start with no access</option>
                {roles.map(r => {
                  const beyond = !!ceiling && !canGrant(ceiling, r.permissions as Perm[])
                  return <option key={r.id} value={r.id} disabled={beyond}>{isOwner ? `${r.department.name} · ` : ''}{r.name}{beyond ? ' (above your access)' : ''}</option>
                })}
              </select>
            </Field>
          )}
        </form>
      </Modal>
    )
  }

  return (
    <div className={`um-roles${showDetail ? ' is-detail' : ''}`}>
      <aside className="card um-rolelist" aria-label="Roles">
        <div className="card-hd"><h3>Roles</h3>{addButton}</div>
        {grouped.map(([dept, rs]) => (
          <div key={dept} className="um-rolegroup">
            {isOwner && <div className="cs-matrix-gh">{dept}</div>}
            {rs.map(r => (
              <button key={r.id} type="button" className="um-role" aria-pressed={r.id === selected?.id} onClick={() => trySelect(r.id)}>
                <span className="um-role-text">
                  <span className="td-name ui-block">{r.name}</span>
                  <span className="td-sub ui-block">
                    {r.status === 'Archived' ? 'Archived' : `${screenCount(r.permissions)} of ${SCREENS.length} screens`}
                  </span>
                </span>
                <span className="um-role-count">{r.staffCount} {r.staffCount === 1 ? 'person' : 'people'}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>

      {selected && (
        <div className="um-editor">
          <section className="card" aria-label={`${selected.name} details`}>
            <button type="button" className="um-link um-back" onClick={() => trySelect(LIST)}><Icons.back size={16} aria-hidden="true" /> All roles</button>
            <div className="um-editor-hd">
              <div className="um-editor-title">
                <h2 className="um-role-name">{selected.name}</h2>
                <div className="td-sub">
                  {selected.department.name} · {selected.staffCount} {selected.staffCount === 1 ? 'person' : 'people'}
                  {selected.status === 'Archived' && ' · Archived'}
                </div>
              </div>
              {editable ? (
                <div className="um-actions">
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => openForm('rename')}>Rename</button>
                  <button type="button" className="btn btn-sm btn-outline" disabled={dirty} onClick={() => openForm('duplicate')}>Duplicate</button>
                  <button type="button" className="btn btn-sm btn-outline" onClick={exportRole}>Export CSV</button>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => { setActionError(''); setStatusTarget(selected) }}>
                    {selected.status === 'Active' ? 'Archive' : 'Reactivate'}
                  </button>
                </div>
              ) : <span className="cs-muted">Above your access</span>}
            </div>
            <div className="um-editor-tools">
              <span className="cs-muted">{screenCount(current)} of {SCREENS.length} screens</span>
              {editable && <button type="button" className="um-link" onClick={() => setAll(true)}>Select all</button>}
              {editable && <button type="button" className="um-link" onClick={() => setAll(false)}>Clear all</button>}
              <button type="button" className="um-link" onClick={() => setOpenGroups(allOpen ? new Set() : new Set(ACCESS_GROUPS))}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
            </div>
          </section>

          <PermissionMatrix idPrefix="rl" value={current} onChange={setDraft} ceiling={ceiling} disabled={!editable || busy}
            openGroups={openGroups} onToggleGroup={toggleGroup} />

          {dirty && (
            <div className="um-savebar" role="status">
              <span>Unsaved changes</span>
              <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={() => setDraft(null)}>Discard</button>
              <button type="button" className="btn btn-sm btn-green" disabled={busy} onClick={saveAccess}>{busy ? 'Saving…' : 'Save access'}</button>
            </div>
          )}
        </div>
      )}

      {renderForm()}

      {pendingSwitch && selected && (
        <ConfirmModal title={`Discard changes to ${selected.name}?`} body="The access you changed won’t be saved." confirmLabel="Discard" danger
          onConfirm={() => selectNow(pendingSwitch)} onClose={() => setPendingSwitch(null)} />
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
    </div>
  )
}
