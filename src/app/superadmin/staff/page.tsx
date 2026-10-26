'use client'

import { useState, useEffect, useCallback } from 'react'

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

const ROLES = ['Ops Manager', 'Finance', 'Support']
const ALL_PERMISSIONS = ['Agents', 'Customers', 'Transactions', 'Reports', 'Wallets', 'Commission', 'Loans']

const ROLE_BADGE: Record<string, { bg: string; color: string }> = {
  'Super Admin': { bg: '#ede9fe', color: '#7c3aed' },
  'Ops Manager': { bg: '#dbeafe', color: '#1d4ed8' },
  'Finance':     { bg: '#ccfbf1', color: '#0f766e' },
  'Support':     { bg: '#f1f5f9', color: '#64748b' },
}

function roleBadge(role: string) {
  const s = ROLE_BADGE[role] ?? ROLE_BADGE['Support']
  return (
    <span style={{
      background: s.bg,
      color: s.color,
      borderRadius: 6,
      padding: '2px 10px',
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: 'nowrap' as const,
    }}>
      {role}
    </span>
  )
}

function parsePerms(raw: string): string[] {
  try { return JSON.parse(raw) } catch { return [] }
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const emptyForm = { name: '', email: '', role: 'Support', permissions: [] as string[], password: '' }

const PAGE_SIZE = 20

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffUser[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ ...emptyForm, permissions: [] as string[] })
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')
  const [showPinModal, setShowPinModal] = useState(false)
  const [pinForm, setPinForm] = useState({ pin: '', currentPassword: '' })
  const [pinLoading, setPinLoading] = useState(false)
  const [pinError, setPinError] = useState('')

  const [editTarget, setEditTarget] = useState<StaffUser | null>(null)
  const [editRole, setEditRole] = useState('')
  const [editPerms, setEditPerms] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/staff')
    const d = res.ok ? await res.json() : {}
    setStaff(d.staff ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function togglePerm(perm: string, perms: string[], setPerms: (p: string[]) => void) {
    setPerms(perms.includes(perm) ? perms.filter(p => p !== perm) : [...perms, perm])
  }

  async function createStaff() {
    setFormError('')
    if (!form.name || !form.email || !form.role || !form.password) {
      setFormError('All fields are required'); return
    }
    setCreating(true)
    const res = await fetch('/api/admin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    setCreating(false)
    if (!res.ok) { setFormError(data.error ?? 'Failed to create staff'); return }
    setShowModal(false)
    setForm({ ...emptyForm, permissions: [] })
    showToast(`Staff ${data.staff.name} created`)
    load()
  }

  async function toggleStatus(s: StaffUser) {
    const newStatus = s.status === 'Active' ? 'Suspended' : 'Active'
    const res = await fetch(`/api/admin/staff/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) {
      showToast(`${s.name} ${newStatus === 'Active' ? 'activated' : 'suspended'}`)
      load()
    }
  }

  async function saveEdit() {
    if (!editTarget) return
    setSaving(true)
    const res = await fetch(`/api/admin/staff/${editTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: editRole, permissions: editPerms }),
    })
    setSaving(false)
    if (res.ok) {
      setEditTarget(null)
      showToast('Staff updated')
      load()
    }
  }

  async function deleteStaff(s: StaffUser) {
    if (!confirm(`Delete ${s.name}? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/staff/${s.id}`, { method: 'DELETE' })
    if (res.ok) { showToast(`${s.name} deleted`); load() }
  }

  async function setApprovalPin() {
    if (!pinForm.pin || pinForm.pin.length < 4) { setPinError('PIN must be at least 4 digits'); return }
    if (!pinForm.currentPassword) { setPinError('Enter your admin password'); return }
    setPinLoading(true); setPinError('')
    const res = await fetch('/api/admin/set-approval-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pinForm),
    })
    const data = await res.json()
    setPinLoading(false)
    if (!res.ok) { setPinError(data.error ?? 'Failed'); return }
    setShowPinModal(false); setPinForm({ pin: '', currentPassword: '' })
    showToast('Approval PIN updated successfully')
  }

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 9999,
          background: '#1a5c35', color: '#fff', borderRadius: 10,
          padding: '12px 22px', fontWeight: 600, fontSize: 14,
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        }}>{toast}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text1)' }}>Staff &amp; Privileges</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 2 }}>Manage staff accounts and access permissions</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="a-btn-ghost" onClick={() => { setPinError(''); setShowPinModal(true) }}>🔑 Set Approval PIN</button>
          <button className="a-btn" onClick={() => { setForm({ ...emptyForm, permissions: [] }); setFormError(''); setShowModal(true) }}>＋ Add Staff</button>
        </div>
      </div>

      <div className="a-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text3)' }}>Loading…</div>
        ) : staff.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text3)' }}>No staff members yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="a-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Role</th>
                  <th>Permissions</th>
                  <th>Last Active</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staff.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(s => {
                  const perms = parsePerms(s.permissions)
                  return (
                    <tr key={s.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: '50%',
                            background: 'var(--green)', color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, fontSize: 13, flexShrink: 0,
                          }}>
                            {initials(s.name)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text1)', fontSize: 14 }}>{s.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{s.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>{roleBadge(s.role)}</td>
                      <td>
                        <span style={{ fontSize: 13, color: 'var(--text2)' }}>
                          {perms.length === 0 ? <span style={{ color: 'var(--text3)' }}>None</span> : perms.join(', ')}
                        </span>
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--text3)' }}>
                        {s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <span style={{
                          background: s.status === 'Active' ? '#dcfce7' : '#fee2e2',
                          color: s.status === 'Active' ? '#16a34a' : '#dc2626',
                          borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 600,
                        }}>
                          {s.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="a-btn-sm"
                            onClick={() => { setEditTarget(s); setEditRole(s.role); setEditPerms(parsePerms(s.permissions)) }}
                          >
                            Edit
                          </button>
                          <button
                            className="a-btn-sm"
                            style={{
                              background: s.status === 'Active' ? '#fef3c7' : '#dcfce7',
                              color: s.status === 'Active' ? '#d97706' : '#16a34a',
                            }}
                            onClick={() => toggleStatus(s)}
                          >
                            {s.status === 'Active' ? 'Suspend' : 'Activate'}
                          </button>
                          <button
                            className="a-btn-sm"
                            style={{ background: '#fee2e2', color: '#dc2626' }}
                            onClick={() => deleteStaff(s)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          {Math.ceil(staff.length / PAGE_SIZE) > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, staff.length)} of {staff.length}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="a-btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 80, textAlign: 'center' }}>Page {page} of {Math.ceil(staff.length / PAGE_SIZE)}</span>
                <button className="a-btn-sm" disabled={page === Math.ceil(staff.length / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            </div>
          )}
          </div>
        )}
      </div>

      {showModal && (
        <div className="a-modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="a-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="a-modal-header">
              <div className="a-modal-title">Add Staff Member</div>
              <button className="a-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="a-modal-body">
              {formError && (
                <div style={{ background: '#fee2e2', color: '#dc2626', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
                  {formError}
                </div>
              )}
              <div className="a-form-row">
                <label>Full Name</label>
                <input className="a-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Doe" />
              </div>
              <div className="a-form-row">
                <label>Email</label>
                <input className="a-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@vochus.com" />
              </div>
              <div className="a-form-row">
                <label>Role</label>
                <select className="a-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="a-form-row">
                <label>Permissions</label>
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '8px 16px', marginTop: 4 }}>
                  {ALL_PERMISSIONS.map(p => {
                    const checked = form.permissions.includes(p)
                    return (
                      <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }} onClick={() => togglePerm(p, form.permissions, perms => setForm(f => ({ ...f, permissions: perms })))}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, border: `2px solid ${checked ? 'var(--green)' : '#ccc'}`, background: checked ? 'var(--green)' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' }}>
                          {checked && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                        </div>
                        {p}
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="a-form-row">
                <label>Password</label>
                <input className="a-input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
              </div>
            </div>
            <div className="a-modal-footer">
              <button className="a-btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="a-btn" onClick={createStaff} disabled={creating}>
                {creating ? 'Creating…' : 'Create Staff'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPinModal && (
        <div className="a-modal-backdrop" onClick={() => setShowPinModal(false)}>
          <div className="a-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="a-modal-header">
              <div className="a-modal-title">🔑 Set Approval PIN</div>
              <button className="a-modal-close" onClick={() => setShowPinModal(false)}>✕</button>
            </div>
            <div className="a-modal-body">
              <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>
                This PIN is required to approve or reject redemption requests.
              </p>
              <div className="a-form-row">
                <label>New PIN (4+ digits)</label>
                <input className="a-input" type="password" inputMode="numeric" value={pinForm.pin} onChange={e => setPinForm(f => ({ ...f, pin: e.target.value }))} placeholder="e.g. 4163" />
              </div>
              <div className="a-form-row">
                <label>Your Admin Password (to confirm)</label>
                <input className="a-input" type="password" value={pinForm.currentPassword} onChange={e => setPinForm(f => ({ ...f, currentPassword: e.target.value }))} placeholder="••••••••" />
              </div>
              {pinError && <div style={{ color: '#dc2626', fontSize: 12.5, marginTop: 4 }}>{pinError}</div>}
            </div>
            <div className="a-modal-footer">
              <button className="a-btn-ghost" onClick={() => setShowPinModal(false)}>Cancel</button>
              <button className="a-btn" onClick={setApprovalPin} disabled={pinLoading}>
                {pinLoading ? 'Saving…' : 'Save PIN'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="a-modal-backdrop" onClick={() => setEditTarget(null)}>
          <div className="a-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="a-modal-header">
              <div className="a-modal-title">Edit — {editTarget.name}</div>
              <button className="a-modal-close" onClick={() => setEditTarget(null)}>✕</button>
            </div>
            <div className="a-modal-body">
              <div className="a-form-row">
                <label>Role</label>
                <select className="a-input" value={editRole} onChange={e => setEditRole(e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="a-form-row">
                <label>Permissions</label>
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '8px 16px', marginTop: 4 }}>
                  {ALL_PERMISSIONS.map(p => {
                    const checked = editPerms.includes(p)
                    return (
                      <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }} onClick={() => togglePerm(p, editPerms, setEditPerms)}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, border: `2px solid ${checked ? 'var(--green)' : '#ccc'}`, background: checked ? 'var(--green)' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' }}>
                          {checked && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                        </div>
                        {p}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="a-modal-footer">
              <button className="a-btn-ghost" onClick={() => setEditTarget(null)}>Cancel</button>
              <button className="a-btn" onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
