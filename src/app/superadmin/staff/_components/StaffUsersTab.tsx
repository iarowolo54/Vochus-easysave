'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { Avatar, ConfirmModal, Empty, Pager, SearchField, shortDate } from '../../_components/admin-ui'
import type { Perm } from '@/lib/permissions'
import { ManagePersonModal, type PersonAction } from './PersonModals'
import { NO_CONNECTION, downloadCsv, errorOf, sendJson, type InviteLink, type StaffData, type StaffUser, type Toast } from './shared'

const PAGE_SIZE = 20
const ALL = 'all'
const NO_ROLE = 'none'

type BulkKind = 'suspend' | 'reactivate' | 'remove' | 'role'
type Bulk = { kind: BulkKind; targets: StaffUser[]; roleId?: string }

const BULK_DONE: Record<BulkKind, string> = { suspend: 'suspended', reactivate: 'reactivated', remove: 'removed', role: 'moved to the new role' }

function StatusBadge({ status }: { status: string }) {
  if (status === 'Active') return <span className="bdg bdg-g">Active</span>
  if (status === 'Invited') return <span className="bdg bdg-grey">Invited</span>
  return <span className="bdg bdg-r">{status}</span>
}

export default function StaffUsersTab({ data, isOwner, ceiling, toast, reload, departmentFilter, onDepartmentFilter, onAdd, onInviteLink }: {
  data: StaffData
  isOwner: boolean
  ceiling: Perm[] | null
  toast: Toast
  reload: () => void
  departmentFilter: string
  onDepartmentFilter: (id: string) => void
  onAdd: () => void
  onInviteLink: (l: InviteLink) => void
}) {
  const { staff, roles, departments } = data
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState(ALL)
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const [manageId, setManageId] = useState<string | null>(null)
  const [statusTarget, setStatusTarget] = useState<StaffUser | null>(null)
  const [removeTarget, setRemoveTarget] = useState<StaffUser | null>(null)
  const [bulk, setBulk] = useState<Bulk | null>(null)
  const [bulkRoleId, setBulkRoleId] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  // A ticked person hidden by a new filter could be suspended or removed unseen, so filters clear the ticks.
  useEffect(() => { setPage(1); setSelected(new Set()) }, [search, roleFilter, statusFilter, departmentFilter])

  const q = search.trim().toLowerCase()
  const shown = useMemo(() => staff.filter(s =>
    (!q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || (s.department?.name ?? '').toLowerCase().includes(q))
    && (departmentFilter === ALL || s.department?.id === departmentFilter)
    && (roleFilter === ALL || (roleFilter === NO_ROLE ? !s.role : s.role?.id === roleFilter))
    && (statusFilter === ALL || s.status === statusFilter),
  ), [staff, q, departmentFilter, roleFilter, statusFilter])
  const paginated = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const manageTarget = staff.find(s => s.id === manageId) ?? null

  const picked = staff.filter(s => selected.has(s.id))
  const pageAllPicked = paginated.length > 0 && paginated.every(s => selected.has(s.id))
  const filtersOn = !!q || departmentFilter !== ALL || roleFilter !== ALL || statusFilter !== ALL

  // A role belongs to one department, so a bulk role change needs everyone to share it.
  const commonDept = picked.length > 0 && picked.every(s => s.department && s.department.id === picked[0].department?.id) ? picked[0].department : null
  const bulkRoles = commonDept ? roles.filter(r => r.status === 'Active' && r.department.id === commonDept.id) : []

  function toggleOne(id: string) {
    setSelected(prev => { const n = new Set(prev); if (!n.delete(id)) n.add(id); return n })
  }

  function togglePage() {
    setSelected(prev => {
      const n = new Set(prev)
      paginated.forEach(s => { if (pageAllPicked) n.delete(s.id); else n.add(s.id) })
      return n
    })
  }

  function exportCsv() {
    downloadCsv('vochus-staff.csv', [
      ['Name', 'Email', 'Department', 'Role', 'Department lead', 'Approval PIN', 'Status', 'Last active'],
      ...shown.map(s => [s.name, s.email, s.department?.name ?? '', s.role?.name ?? '', s.isLead ? 'Yes' : 'No', s.hasApprovalPin ? 'Set' : 'Not set', s.status, s.lastActiveAt ? shortDate(s.lastActiveAt) : 'Never']),
    ])
  }

  async function resend(s: StaffUser) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/staff/${s.id}/resend-invite`, { method: 'POST' })
      if (!res.ok) { toast(await errorOf(res, 'The invite wasn’t sent. Try again.'), 'error'); return }
      const d: { link?: string } = await res.json().catch(() => ({}))
      if (d.link) onInviteLink({ name: s.name, link: d.link })
      else toast(`New invite sent to ${s.email}. The old link no longer works.`, 'success')
    } catch { toast(NO_CONNECTION, 'error') } finally { setBusy(false) }
  }

  function onPersonAction(a: PersonAction) {
    const p = manageTarget
    if (!p) return
    setManageId(null); setActionError('')
    if (a === 'resend') resend(p)
    else if (a === 'status') setStatusTarget(p)
    else setRemoveTarget(p)
  }

  async function changeStatus() {
    const s = statusTarget
    if (!s) return
    const suspend = s.status === 'Active'
    setBusy(true); setActionError('')
    const r = await sendJson(`/api/admin/staff/${s.id}`, 'PATCH', { status: suspend ? 'Suspended' : 'Active' })
    setBusy(false)
    if (!r.ok) { setActionError(r.error); return }
    toast(`${s.name} ${suspend ? 'suspended' : 'reactivated'}`, 'success')
    setStatusTarget(null); reload()
  }

  async function removePerson() {
    const s = removeTarget
    if (!s) return
    setBusy(true); setActionError('')
    const r = await sendJson(`/api/admin/staff/${s.id}`, 'DELETE')
    setBusy(false)
    if (!r.ok) { setActionError(r.error); return }
    toast(`${s.name}’s login is removed`, 'success')
    setRemoveTarget(null); reload()
  }

  function openBulk(kind: BulkKind) {
    const targets = kind === 'suspend' ? picked.filter(s => s.status === 'Active')
      : kind === 'reactivate' ? picked.filter(s => s.status === 'Suspended')
      : picked
    if (targets.length === 0) { toast(kind === 'suspend' ? 'No one you ticked is active.' : 'No one you ticked is suspended.', 'error'); return }
    setActionError('')
    setBulk({ kind, targets, roleId: kind === 'role' ? bulkRoleId : undefined })
  }

  async function runBulk() {
    if (!bulk) return
    setBusy(true); setActionError('')
    // One at a time: production has two processes writing to one SQLite file.
    const failed: StaffUser[] = []
    for (const t of bulk.targets) {
      const url = `/api/admin/staff/${t.id}`
      const r = bulk.kind === 'remove' ? await sendJson(url, 'DELETE')
        : await sendJson(url, 'PATCH', bulk.kind === 'role' ? { roleId: bulk.roleId || null } : { status: bulk.kind === 'suspend' ? 'Suspended' : 'Active' })
      if (!r.ok) failed.push(t)
    }
    setBusy(false)
    reload()
    const done = bulk.targets.length - failed.length
    setSelected(new Set(failed.map(f => f.id)))
    if (failed.length) {
      setBulk({ ...bulk, targets: failed })
      setActionError(`${done} done. These didn’t go through: ${failed.map(f => f.name).join(', ')}.`)
      return
    }
    toast(`${done} ${done === 1 ? 'person' : 'people'} ${BULK_DONE[bulk.kind]}`, 'success')
    setBulk(null); setBulkRoleId('')
  }

  const bulkRoleName = bulk?.kind === 'role' ? (roles.find(r => r.id === bulk.roleId)?.name ?? 'No role') : ''
  const bulkTitle = bulk ? (bulk.kind === 'role' ? `Change ${bulk.targets.length} to ${bulkRoleName}?`
    : `${bulk.kind === 'suspend' ? 'Suspend' : bulk.kind === 'reactivate' ? 'Reactivate' : 'Remove'} ${bulk.targets.length} ${bulk.targets.length === 1 ? 'login' : 'logins'}?`) : ''
  const skipped = bulk ? picked.length - bulk.targets.length : 0
  const roleOptions = departmentFilter === ALL ? roles : roles.filter(r => r.department.id === departmentFilter)

  return (
    <>
      <div className="um-filters">
        <SearchField value={search} onChange={setSearch} placeholder="Name, email or department" label="Search people" />
        {isOwner && (
          <select className="a-input" aria-label="Department" value={departmentFilter} onChange={e => { setRoleFilter(ALL); onDepartmentFilter(e.target.value) }}>
            <option value={ALL}>All departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <select className="a-input" aria-label="Role" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value={ALL}>All roles</option>
          <option value={NO_ROLE}>No role</option>
          {roleOptions.map(r => <option key={r.id} value={r.id}>{isOwner && departmentFilter === ALL ? `${r.department.name} · ${r.name}` : r.name}</option>)}
        </select>
        <select className="a-input" aria-label="Status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value={ALL}>All statuses</option>
          <option>Active</option>
          <option>Invited</option>
          <option>Suspended</option>
        </select>
        <button type="button" className="btn btn-outline" onClick={exportCsv} disabled={shown.length === 0}>
          <Icons.download size={18} aria-hidden="true" /> Export CSV
        </button>
      </div>

      {picked.length > 0 && (
        <div className="um-bulk" role="group" aria-label="Actions for ticked people">
          <strong>{picked.length} selected</strong>
          {shown.length > picked.length && <button type="button" className="um-link" onClick={() => setSelected(new Set(shown.map(s => s.id)))}>Select all {shown.length}</button>}
          {commonDept && (
            <span className="um-bulk-role">
              <select className="a-input" aria-label="New role" value={bulkRoleId} onChange={e => setBulkRoleId(e.target.value)}>
                <option value="">Choose a role</option>
                {bulkRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button type="button" className="btn btn-sm btn-green" disabled={!bulkRoleId} onClick={() => openBulk('role')}>Change role</button>
            </span>
          )}
          <button type="button" className="btn btn-sm btn-outline" onClick={() => openBulk('suspend')}>Suspend</button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => openBulk('reactivate')}>Reactivate</button>
          <button type="button" className="btn btn-sm btn-outline um-danger" onClick={() => openBulk('remove')}>Remove</button>
          <button type="button" className="um-link um-bulk-clear" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <section className="card" aria-label="Staff users">
        {shown.length === 0 ? (
          filtersOn ? <Empty icon="search" title="No one matches" text="Try a different search or filter." />
            : <Empty icon="staff" title="No staff logins yet" text="Add a login for each person who helps run Vochus, then give them a role."
                action={<button type="button" className="btn btn-green" onClick={onAdd}>Add person</button>} />
        ) : (
          <>
            <div className="tbl-wrap tbl-stack">
              <table>
                <thead>
                  <tr>
                    <th>
                      <span className="um-th-person">
                        <input type="checkbox" className="um-check" aria-label="Select everyone on this page" checked={pageAllPicked} onChange={togglePage} />
                        Person
                      </span>
                    </th>
                    <th>Department</th><th>Role</th><th>Approval PIN</th><th>Last active</th><th>Status</th><th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(s => (
                    <tr key={s.id}>
                      <td>
                        <div className="td-av">
                          <input type="checkbox" className="um-check" aria-label={`Select ${s.name}`} checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} />
                          <Avatar name={s.name} tone={s.status === 'Active' ? 'green' : 'grey'} />
                          <span className="um-person">
                            <span className="td-name ui-block">{s.name}</span>
                            <span className="td-sub ui-block">{s.email}</span>
                          </span>
                        </div>
                      </td>
                      <td data-label="Department">{s.department?.name ?? <span className="cs-muted">None</span>}</td>
                      <td data-label="Role">
                        <span>
                          {s.role?.name ?? <span className="cs-muted">No access</span>}
                          {s.isLead && <span className="cs-chip um-lead">Lead</span>}
                        </span>
                      </td>
                      <td data-label="Approval PIN">{s.hasApprovalPin ? <span className="bdg bdg-g">Set</span> : <span className="bdg bdg-grey">Not set</span>}</td>
                      <td data-label="Last active">{s.lastActiveAt ? shortDate(s.lastActiveAt) : <span className="cs-muted">Never</span>}</td>
                      <td data-label="Status"><StatusBadge status={s.status} /></td>
                      <td>
                        <div className="a-row-actions">
                          <button type="button" className="btn btn-sm btn-outline" onClick={() => setManageId(s.id)}>Manage</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={PAGE_SIZE} total={shown.length} onPage={setPage} />
          </>
        )}
      </section>

      {manageTarget && (
        <ManagePersonModal key={manageTarget.id} person={manageTarget} roles={roles} departments={departments} isOwner={isOwner} ceiling={ceiling}
          toast={toast} onClose={() => setManageId(null)} onDone={reload} onAction={onPersonAction} />
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
          onConfirm={changeStatus} onClose={() => { if (!busy) setStatusTarget(null) }}
        />
      )}

      {removeTarget && (
        <ConfirmModal
          title={`Remove ${removeTarget.name}’s login?`}
          body={<>This permanently removes the staff login for <strong>{removeTarget.email}</strong>. You can’t undo this. To stop access for a while instead, suspend the login.</>}
          confirmLabel="Remove login" danger
          busy={busy} error={actionError}
          onConfirm={removePerson} onClose={() => { if (!busy) setRemoveTarget(null) }}
        />
      )}

      {bulk && (
        <ConfirmModal
          title={bulkTitle}
          body={<>
            {bulk.targets.slice(0, 6).map(t => t.name).join(', ')}{bulk.targets.length > 6 ? ` and ${bulk.targets.length - 6} more` : ''}.
            {bulk.kind === 'remove' && ' You can’t undo this.'}
            {skipped > 0 && !actionError && ` ${skipped} ticked ${skipped === 1 ? 'person isn’t' : 'people aren’t'} affected.`}
          </>}
          confirmLabel={actionError ? 'Try again' : bulk.kind === 'role' ? 'Change role' : bulk.kind === 'suspend' ? 'Suspend' : bulk.kind === 'reactivate' ? 'Reactivate' : 'Remove'}
          danger={bulk.kind === 'suspend' || bulk.kind === 'remove'}
          busy={busy} error={actionError}
          onConfirm={runBulk} onClose={() => { if (!busy) { setBulk(null); setActionError('') } }}
        />
      )}
    </>
  )
}
