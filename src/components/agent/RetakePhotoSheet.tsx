'use client'
import { useEffect, useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import CameraCapture from '@/components/ui/CameraCapture'
import { Icons } from '@/components/ui/icons'

/** Take a new photo of one of the agent's customers with the camera (never the gallery, as at registration). */
export default function RetakePhotoSheet({ customer, onClose, onSaved }: {
  customer: { id: string; name: string; hasPhoto: boolean } | null
  onClose: () => void
  /** Called with the new photo link once it's saved. */
  onSaved: (photoUrl: string) => void
}) {
  const [shot, setShot] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Keyed on the id: the parent builds a new object each render, which must not wipe a photo just taken.
  const customerId = customer?.id ?? null
  useEffect(() => { setShot(null); setSaveError('') }, [customerId])

  async function save() {
    if (!customer || !shot) return
    setSaving(true); setSaveError('')
    try {
      const res = await fetch(`/api/customers/${customer.id}/photo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoUrl: shot }),
      })
      const data: { photoUrl?: string; error?: string } = await res.json().catch(() => ({}))
      if (!res.ok || !data.photoUrl) { setSaveError(data.error ?? 'The photo wasn’t saved. Try again.'); return }
      onSaved(data.photoUrl)
    } catch {
      setSaveError('No connection. Check your internet and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet open={!!customer} onClose={() => { if (!saving) onClose() }} title={customer?.hasPhoto ? 'Retake photo' : 'Add photo'}>
      {/* Mounted only while open, so closing the sheet always turns the camera off. */}
      {customer && (
        <>
          <CameraCapture value={shot} onChange={s => { setShot(s); setSaveError('') }} />
          {saveError && <p className="ui-field-error ag-center" role="alert"><Icons.error size={16} aria-hidden="true" /> {saveError}</p>}
          {shot && (
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block ui-gap-top" onClick={save} disabled={saving} aria-busy={saving}>
              {saving ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Saving…</> : 'Use this photo'}
            </button>
          )}
        </>
      )}
    </BottomSheet>
  )
}
