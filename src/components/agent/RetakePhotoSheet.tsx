'use client'
import { useEffect, useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import CameraCapture from '@/components/ui/CameraCapture'
import { Icons } from '@/components/ui/icons'

/**
 * Take or upload a photo of one of the agent's customers (Take photo and Upload photo side by side, as on the Enrol
 * photo step). It goes to the super admin to check; the customer's photo only changes once it's approved.
 */
export default function RetakePhotoSheet({ customer, onClose, onSubmitted }: {
  customer: { id: string; name: string; hasPhoto: boolean } | null
  onClose: () => void
  /** Called once the photo is sent for checking. */
  onSubmitted: () => void
}) {
  const [shot, setShot] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [sent, setSent] = useState(false)

  // Keyed on the id: the parent builds a new object each render, which must not wipe a photo just taken.
  const customerId = customer?.id ?? null
  useEffect(() => { setShot(null); setSaveError(''); setSent(false) }, [customerId])

  async function save() {
    if (!customer || !shot) return
    setSaving(true); setSaveError('')
    try {
      const res = await fetch(`/api/customers/${customer.id}/photo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoUrl: shot }),
      })
      const data: { ok?: boolean; error?: string } = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { setSaveError(data.error ?? 'The photo wasn’t sent. Try again.'); return }
      setSent(true)
      onSubmitted()
    } catch {
      setSaveError('No connection. Check your internet and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet open={!!customer} onClose={() => { if (!saving) onClose() }} title={customer?.hasPhoto ? 'Retake photo' : 'Add photo'}>
      {/* Mounted only while open, so closing the sheet always turns the camera off. */}
      {customer && sent && (
        <div className="ag-center">
          <p className="ui-row-title"><Icons.check size={18} aria-hidden="true" /> Sent for checking</p>
          <p className="ui-row-sub">The office will check the photo. You’ll get a notice when it’s approved or if they need a new one.</p>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block ui-gap-top" onClick={onClose}>Done</button>
        </div>
      )}
      {customer && !sent && (
        <>
          <CameraCapture value={shot} onChange={s => { setShot(s); setSaveError('') }} allowUpload />
          {saveError && <p className="ui-field-error ag-center" role="alert"><Icons.error size={16} aria-hidden="true" /> {saveError}</p>}
          {shot && (
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block ui-gap-top" onClick={save} disabled={saving} aria-busy={saving}>
              {saving ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending…</> : 'Send for checking'}
            </button>
          )}
        </>
      )}
    </BottomSheet>
  )
}
