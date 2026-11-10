'use client'

import { useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { ConfirmModal, Empty, Field, Modal } from '../../_components/admin-ui'
import type { Perm } from '@/lib/permissions'
import PermissionMatrix from './PermissionMatrix'
import { sendJson, type Department, type StaffData, type Toast } from './shared'

type RoleDraft = { key: number; name: string; perms: Perm[] }

/** Owner only. Creating a department can add its first roles in the same dialog. */
export default function DepartmentsTab({ data, toast, reload, onViewPeople }: {
  data: StaffData
  toast: Toast
  reload: () => void
  onViewPeople: (departmentId: string) => void
}) {
  const { departments: items, staff } = data
  const [editing, setEditing] = useState<Department | 'new' | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [leadId, setLeadId] = useState('')
  const [drafts, setDrafts] = useState<RoleDraft[]>([])
  const [nameError, setNameError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [statusTarget, setStatusTarget] = useState<Department | null>(null)
  const [actionError, setActionError] = useState('')

  function open(d: Department | 'new') {
    setEditing(d); setNameError(''); setFormError(''); setDrafts([])
    setName(d === 'new' ? '' : d.name)
    setDescription(d === 'new' ? '' : d.description ?? '')
    setLeadId(d === 'new' ? '' : d.lead?.id ?? '')
  }

  const addDraft = () => setDrafts(ds => [...ds, { key: Date.now() + ds.length, name: '', perms: [] }])
  const patchDraft = (key: number, patch: Partial<RoleDraft>) => setDrafts(ds => ds.map(d => d.key === key ? { ...d, ...patch } : d))

  // Only Active people of this department can be appointed lead.
  const candidates = editing && editing !== 'new' ? staff.filter(s => s.department?.id === editing.id && s.status === 'Active') : []
  const currentLead = editing && editing !== 'new' ? editing.lead : null

  async function save() {
    if (!editing) return
    if (!name.trim()) { setNameError('Enter a department name.'); return }
    if (drafts.some(d => !d.name.trim())) { setFormError('Give every role a name, or remove the empty ones.'); return }
    setBusy(true); setFormError('')
    const r = editing === 'new'
      ? await sendJson('/api/admin/departments', 'POST', {
          name: name.trim(), description: description.trim() || undefined,
          roles: drafts.map(d => ({ name: d.name.trim(), permissions: d.perms })),
        })
      : await sendJson(`/api/admin/departments/${editing.id}`, 'PATCH', {
          name: name.trim(), description: description.trim() || null,
          ...(leadId !== (editing.lead?.id ?? '') ? { leadId: leadId || null } : {}),
        })
    setBusy(false)
    if (!r.ok) { setFormError(r.error); return }
    toast(editing === 'new' ? `${name.trim()} department created` : 'Department updated', 'success')
    setEditing(null); reload()
  }

  async function toggleStatus() {
    const d = statusTarget
    if (!d) return
    const next = d.status === 'Active' ? 'Archived' : 'Active'
    setBusy(true); setActionError('')
    const r = await sendJson(`/api/admin/departments/${d.id}`, 'PATCH', { status: next })
    setBusy(false)
    if (!r.ok) { setActionError(r.error); return }
    toast(`${d.name} ${next === 'Active' ? 'reactivated' : 'archived'}`, 'success')
    setStatusTarget(null); reload()
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn btn-green" onClick={() => open('new')}><Icons.add size={18} aria-hidden="true" /> Add department</button>
      </div>

      <section className="card" aria-label="Departments">
        {items.length === 0 ? (
          <Empty icon="staff" title="No departments yet" text="A department groups roles and people, like Finance or Support. Create one and add its roles in the same step."
            action={<button type="button" className="btn btn-green" onClick={() => open('new')}>Add department</button>} />
        ) : (
          <div className="tbl-wrap tbl-stack">
            <table>
              <thead>
                <tr><th>Department</th><th>Lead</th><th>Roles</th><th>People</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {items.map(d => (
                  <tr key={d.id}>
                    <td>
                      <span className="td-name ui-block">{d.name}</span>
                      {d.description && <span className="td-sub ui-block">{d.description}</span>}
                    </td>
                    <td data-label="Lead">{d.lead ? d.lead.name : <span className="cs-muted">None</span>}</td>
                    <td data-label="Roles">{d.roleCount}</td>
                    <td data-label="People">{d.memberCount}</td>
                    <td data-label="Status">{d.status === 'Active' ? <span className="bdg bdg-g">Active</span> : <span className="bdg bdg-grey">Archived</span>}</td>
                    <td>
                      <div className="a-row-actions">
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => onViewPeople(d.id)}>View people</button>
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => open(d)}>Edit</button>
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => { setActionError(''); setStatusTarget(d) }}>
                          {d.status === 'Active' ? 'Archive' : 'Reactivate'}
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
        <Modal error={formError || undefined} icon="staff" title={editing === 'new' ? 'Add a department' : 'Edit department'} busy={busy} size="lg"
          sub={editing === 'new' ? 'Set up the department and its first roles together. You can add more later.' : undefined}
          onClose={() => { if (!busy) setEditing(null) }}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </>}>
          <form onSubmit={e => { e.preventDefault(); save() }} noValidate>
            <Field id="dp-name" label="Name" error={nameError}>
              <input id="dp-name" className="a-input" autoComplete="off" placeholder="Finance" value={name} aria-invalid={!!nameError}
                onChange={e => { setName(e.target.value); setNameError('') }} />
            </Field>
            <Field id="dp-desc" label="Description (optional)">
              <input id="dp-desc" className="a-input" autoComplete="off" value={description} onChange={e => setDescription(e.target.value)} />
            </Field>

            {editing !== 'new' && (
              <Field id="dp-lead" label="Department lead"
                hint={candidates.length === 0 && !currentLead
                  ? 'Add and activate someone in this department first, then appoint them lead.'
                  : 'A lead manages this department’s roles and people, but can only give access they hold themselves.'}>
                <select id="dp-lead" className="a-input" value={leadId} disabled={candidates.length === 0 && !currentLead} onChange={e => setLeadId(e.target.value)}>
                  <option value="">No lead</option>
                  {currentLead && !candidates.some(m => m.id === currentLead.id) && <option value={currentLead.id}>{currentLead.name} (not active)</option>}
                  {candidates.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
            )}

            {editing === 'new' && (
              <>
                {drafts.map((d, i) => (
                  <details key={d.key} className="cs-role-draft" open={i === drafts.length - 1}>
                    <summary>{d.name.trim() || `Role ${i + 1}`}</summary>
                    <Field id={`dp-role-${d.key}`} label="Role name">
                      <input id={`dp-role-${d.key}`} className="a-input" autoComplete="off" placeholder="Payout approver" value={d.name}
                        onChange={e => { patchDraft(d.key, { name: e.target.value }); setFormError('') }} />
                    </Field>
                    <PermissionMatrix idPrefix={`dp-${d.key}`} value={d.perms} onChange={perms => patchDraft(d.key, { perms })} />
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => setDrafts(ds => ds.filter(x => x.key !== d.key))}>Remove this role</button>
                  </details>
                ))}
                <button type="button" className="btn btn-outline" onClick={addDraft}><Icons.add size={18} aria-hidden="true" /> Add a role</button>
              </>
            )}
          </form>
        </Modal>
      )}

      {statusTarget && (
        <ConfirmModal
          title={statusTarget.status === 'Active' ? `Archive ${statusTarget.name}?` : `Reactivate ${statusTarget.name}?`}
          body={statusTarget.status === 'Active'
            ? <>The department is hidden from new assignments. Its roles and people are kept, and you can reactivate it later.</>
            : <>The department becomes available again.</>}
          confirmLabel={statusTarget.status === 'Active' ? 'Archive' : 'Reactivate'}
          danger={statusTarget.status === 'Active'}
          busy={busy} error={actionError}
          onConfirm={toggleStatus} onClose={() => { if (!busy) setStatusTarget(null) }}
        />
      )}
    </>
  )
}
