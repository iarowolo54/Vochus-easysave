'use client'

import { useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { Field, Modal, PageHeader, Segmented, useToast } from '../_components/admin-ui'
import DepartmentsView from './_components/DepartmentsView'
import RolesView from './_components/RolesView'
import PeopleView from './_components/PeopleView'
import { errorOf } from './_components/shared'

type Tab = 'people' | 'roles' | 'departments'

export default function StaffPage() {
  const [tab, setTab] = useState<Tab>('people')
  const [toastNode, toast] = useToast()

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

  return (
    <>
      <PageHeader
        title="Staff and access"
        sub="Departments, roles and the people who work in this admin area."
        actions={<button type="button" className="btn btn-outline" onClick={openPin}><Icons.locked size={18} aria-hidden="true" /> Change approval PIN</button>}
      />

      <p className="cs-note" role="note">
        <Icons.report size={16} aria-hidden="true" />
        <span>Staff sign in at the same admin login as you and see only the areas their role allows. Roles that handle money are marked.</span>
      </p>

      <div className="cs-tabs">
        <Segmented<Tab> label="Staff and access sections" value={tab} onChange={setTab} options={[
          { value: 'people', label: 'People' },
          { value: 'roles', label: 'Roles' },
          { value: 'departments', label: 'Departments' },
        ]} />
      </div>

      {tab === 'people' && <PeopleView toast={toast} />}
      {tab === 'roles' && <RolesView toast={toast} />}
      {tab === 'departments' && <DepartmentsView toast={toast} />}

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
