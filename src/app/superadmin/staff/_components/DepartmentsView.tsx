'use client'

import { useState, useEffect, useCallback } from 'react'
import { Icons } from '@/components/ui/icons'
import { ConfirmModal, Empty, Field, LoadError, Modal, TableSkeleton } from '../../_components/admin-ui'
import { type Department, sendJson } from './shared'

export default function DepartmentsView({ toast }: { toast: (m: string, t?: 'success' | 'error') => void }) {
  const [items, setItems] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const [editing, setEditing] = useState<Department | 'new' | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
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

  function open(d: Department | 'new') {
    setEditing(d); setNameError(''); setFormError('')
    setName(d === 'new' ? '' : d.name); setDescription(d === 'new' ? '' : d.description ?? '')
  }

  async function save() {
    if (!editing) return
    if (!name.trim()) { setNameError('Enter a department name.'); return }
    setBusy(true); setFormError('')
    const r = editing === 'new'
      ? await sendJson('/api/admin/departments', 'POST', { name: name.trim(), description: description.trim() || undefined })
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

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn btn-green" onClick={() => open('new')}><Icons.add size={18} aria-hidden="true" /> Add department</button>
      </div>

      <section className="card" aria-label="Departments">
        {loading && !items.length ? <TableSkeleton rows={4} cols={4} />
          : failed ? <LoadError what="departments" onRetry={load} />
          : items.length === 0 ? (
            <Empty icon="staff" title="No departments yet" text="Departments group roles, like Finance or Support. Create one, then add roles to it."
              action={<button type="button" className="btn btn-green" onClick={() => open('new')}>Add department</button>} />
          ) : (
            <div className="tbl-wrap tbl-stack">
              <table>
                <thead>
                  <tr><th>Department</th><th>Roles</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {items.map(d => (
                    <tr key={d.id}>
                      <td>
                        <span className="td-name ui-block">{d.name}</span>
                        {d.description && <span className="td-sub ui-block">{d.description}</span>}
                      </td>
                      <td data-label="Roles">{d.roleCount}</td>
                      <td data-label="Status">{d.status === 'Active' ? <span className="bdg bdg-g">Active</span> : <span className="bdg bdg-grey">Archived</span>}</td>
                      <td>
                        <div className="a-row-actions">
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
        <Modal error={formError || undefined} icon="staff" title={editing === 'new' ? 'Add a department' : 'Edit department'} busy={busy}
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
