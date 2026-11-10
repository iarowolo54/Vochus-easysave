'use client'

import { useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { Empty, Field, LoadError, Modal, PageHeader, Segmented, TableSkeleton, useToast } from '../_components/admin-ui'
import { hasPermission } from '@/lib/permissions'
import AccessMatrixTab from './_components/AccessMatrixTab'
import DepartmentsTab from './_components/DepartmentsTab'
import PermissionChangesTab from './_components/PermissionChangesTab'
import { AddPersonModal } from './_components/PersonModals'
import RolesTab from './_components/RolesTab'
import StaffUsersTab from './_components/StaffUsersTab'
import { errorOf, type InviteLink } from './_components/shared'
import { useStaffData } from './_components/useStaffData'
import { useMyAccess } from '../_components/useMyAccess'
import { actorCeiling } from './_components/ceiling'

type Tab = 'staff' | 'roles' | 'matrix' | 'changes' | 'departments'

export default function StaffPage() {
  const [tab, setTab] = useState<Tab>('staff')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [inviteLink, setInviteLink] = useState<InviteLink | null>(null)
  const [copied, setCopied] = useState(false)
  const [toastNode, toast] = useToast()
  const { state: me, reload: reloadMe } = useMyAccess(true)
  const canManageStaff = me.status === 'ready' && (me.access.role === 'superadmin' || me.access.isLead)
  const { data, loading, failed, reload } = useStaffData(canManageStaff)

  // Approval PIN
  const [showPinModal, setShowPinModal] = useState(false)
  const [pinForm, setPinForm] = useState({ pin: '', currentPassword: '' })
  const [pinAgain, setPinAgain] = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const [pinError, setPinError] = useState('')

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

  function showInvite(l: InviteLink) {
    setCopied(false); setInviteLink(l)
  }

  async function copyLink() {
    if (!inviteLink) return
    try { await navigator.clipboard.writeText(inviteLink.link); setCopied(true) } catch { setCopied(false) }
  }

  if (me.status === 'loading') {
    return <div aria-busy="true"><div className="skel" style={{ width: 240, height: 30, marginBottom: 20 }} /><div className="card"><div className="skel" style={{ height: 220 }} /></div></div>
  }
  if (me.status === 'error') {
    return <section className="card"><LoadError what="your access" onRetry={reloadMe} /></section>
  }
  const isOwner = me.access.role === 'superadmin'
  const ceiling = actorCeiling(me.access)

  if (!canManageStaff) {
    return <section className="card"><Empty icon="staff" title="No department to manage" text="You are not the lead of a department." /></section>
  }
  const showChanges = isOwner || hasPermission(me.access.perms, 'audit', 'view')
  const tabs: { value: Tab; label: string }[] = [
    { value: 'staff', label: 'Staff users' },
    { value: 'roles', label: 'Roles and access' },
    { value: 'matrix', label: 'Access matrix' },
    ...(showChanges ? [{ value: 'changes' as const, label: 'Permission changes' }] : []),
    ...(isOwner ? [{ value: 'departments' as const, label: 'Departments' }] : []),
  ]
  const activeCount = data.staff.filter(s => s.status === 'Active').length
  const suspendedCount = data.staff.filter(s => s.status === 'Suspended').length
  const stats = [
    ['Staff users', data.staff.length],
    ['Active', activeCount],
    ['Suspended', suspendedCount],
    ['Roles', data.roles.filter(r => r.status === 'Active').length],
  ] as const
  const ready = !loading && !failed

  return (
    <>
      <PageHeader
        title="Staff and access"
        actions={<>
          {isOwner && <button type="button" className="btn btn-outline" onClick={openPin}><Icons.locked size={18} aria-hidden="true" /> Change approval PIN</button>}
          <button type="button" className="btn btn-green" disabled={!ready} onClick={() => setShowAdd(true)}><Icons.add size={18} aria-hidden="true" /> Add person</button>
        </>}
      />

      <div className="stats-grid">
        {stats.map(([label, value]) => (
          <div key={label} className="stat">
            <div className="stat-lbl">{label}</div>
            <div className="stat-val">{ready ? value : <span className="skel cs-stat-skel" />}</div>
          </div>
        ))}
      </div>

      <div className="cs-tabs um-tabs">
        <Segmented<Tab> label="Staff and access sections" value={tab} onChange={setTab} options={tabs} />
      </div>

      {failed ? <section className="card"><LoadError what="staff and roles" onRetry={reload} /></section>
        : loading ? <section className="card"><TableSkeleton rows={5} cols={5} /></section>
        : (
          <>
            {tab === 'staff' && (
              <StaffUsersTab data={data} isOwner={isOwner} ceiling={ceiling} toast={toast} reload={reload}
                departmentFilter={departmentFilter} onDepartmentFilter={setDepartmentFilter}
                onAdd={() => setShowAdd(true)} onInviteLink={showInvite} />
            )}
            {/* Stays mounted so switching tabs can't lose unsaved access changes. */}
            <div hidden={tab !== 'roles'}>
              <RolesTab data={data} isOwner={isOwner} ceiling={ceiling} toast={toast} reload={reload} />
            </div>
            {tab === 'matrix' && <AccessMatrixTab data={data} isOwner={isOwner} />}
            {tab === 'changes' && showChanges && <PermissionChangesTab />}
            {tab === 'departments' && isOwner && (
              <DepartmentsTab data={data} toast={toast} reload={reload}
                onViewPeople={id => { setDepartmentFilter(id); setTab('staff') }} />
            )}
          </>
        )}

      {showAdd && (
        <AddPersonModal roles={data.roles} departments={data.departments} isOwner={isOwner} ceiling={ceiling} toast={toast}
          onClose={() => setShowAdd(false)} onDone={reload} onInviteLink={showInvite} />
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

      {toastNode}
    </>
  )
}
