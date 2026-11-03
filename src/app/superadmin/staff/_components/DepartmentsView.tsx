'use client'

import { useState, useEffect, useCallback } from 'react'
import { Icons } from '@/components/ui/icons'
import { ConfirmModal, Empty, Field, LoadError, Modal, TableSkeleton } from '../../_components/admin-ui'
import type { Perm } from '@/lib/permissions'
import DepartmentHub from './DepartmentHub'
import PermissionMatrix from './PermissionMatrix'
import { type Department, sendJson } from './shared'

type RoleDraft = { key: number; name: string; perms: Perm[] }

/**
 * The department hub. The owner sees every department (and can open one); a lead is shown their own
 * department's hub directly. Creating a department can add its first roles in the same dialog.
 */
export default function DepartmentsView({ toast, isOwner, ceiling }: {
  toast: (m: string, t?: 'success' | 'error') => void
  isOwner: boolean
  ceiling: Perm[] | null
}) {
  const [items, setItems] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const [editing, setEditing] = useState<Department | 'new' | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [drafts, setDrafts] = useState<RoleDraft[]>([])
  const [nameError, setNameError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const [statusTarget, setStatusTarget] = useState<Department | null>(null)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch('/api/admin/departments')
      if (!res.ok) throw new Error()
      const d = await res.json()
      setItems(d.departments ?? [])
    } catch { setFailed(true) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // A lead has exactly one department: show its hub straight away.
  const leadDept = !isOwner && items.length === 1 ? items[0] : null
  const hubDept = leadDept ?? items.find(d => d.id === openId) ?? null

  function open(d: Department | 'new') {
    setEditing(d); setNameError(''); setFormError(''); setDrafts([])
    setName(d === 'new' ? '' : d.name); setDescription(d === 'new' ? '' : d.description ?? '')
  }

  const addDraft = () => setDrafts(ds => [...ds, { key: Date.now() + ds.length, name: '', perms: [] }])
  const patchDraft = (key: number, patch: Partial<RoleDraft>) => setDrafts(ds => ds.map(d => d.key === key ? { ...d, ...patch } : d))

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
      : await sendJson(`/api/admin/departments/${editing.id}`, 'PATCH', { name: name.trim(), description: description.trim() || null })
    setBusy(false)
    if (!r.ok) { setFormError(r.error); return }
    toast(editing === 'new' ? `${name.trim()} department created` : 'Department updated', 'success')
    setEditing(null); load()
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
    setStatusTarget(null); load()
  }

  if (hubDept) {
    return (
      <>
        {isOwner && (
          <button type="button" className="btn btn-outline cs-hub-back" onClick={() => setOpenId(null)}>← All departments</button>
        )}
        <h2 className="td-name">{hubDept.name}</h2>
        {hubDept.description && <p className="td-sub">{hubDept.description}</p>}
        <DepartmentHub department={hubDept} isOwner={isOwner} ceiling={ceiling} toast={toast} onChanged={load} />
      </>
    )
  }

  if (!isOwner) {
    return (
      <section className="card">
        {loading ? <TableSkeleton rows={3} cols={3} /> : failed ? <LoadError what="your department" onRetry={load} />
          : <Empty icon="staff" title="No department to manage" text="You are not the lead of a department." />}
      </section>
    )
  }

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn btn-green" onClick={() => open('new')}><Icons.add size={18} aria-hidden="true" /> Add department</button>
      </div>

      <section className="card" aria-label="Departments">
        {loading && !items.length ? <TableSkeleton rows={4} cols={5} />
          : failed ? <LoadError what="departments" onRetry={load} />
          : items.length === 0 ? (
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
                          <button type="button" className="btn btn-sm btn-green" onClick={() => setOpenId(d.id)}>Open</button>
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
