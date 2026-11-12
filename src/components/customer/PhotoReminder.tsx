'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import BottomSheet from '@/components/ui/BottomSheet'
import CameraCapture from '@/components/ui/CameraCapture'
import { Icons } from '@/components/ui/icons'
import { customerPhotoCopy, type CustomerPhoto } from '@/lib/photo-copy'

/** Pages listen for this to reload their data once the customer has added their photo. */
export const PHOTO_UPDATED = 'vochus:photo-updated'
const DISMISSED = 'vochus.photoReminderClosed'

/** The coloured photo warning: the Home banner, and the "Saving is paused" box on Save, Catch up and Ajo. */
export function PhotoNotice({ photo, onTake }: { photo: CustomerPhoto | null | undefined; onTake: () => void }) {
  const copy = photo ? customerPhotoCopy(photo) : null
  if (!copy) return null
  return (
    <div className={`photo-remind photo-remind--${copy.tone}`} role={copy.tone === 'red' ? 'alert' : 'status'}>
      <Icons.camera size={20} aria-hidden="true" />
      <div className="photo-remind-body">
        <p className="photo-remind-title">{copy.title}</p>
        <p className="photo-remind-text">{copy.text}</p>
        {copy.camera && <button type="button" className="ui-btn ui-btn--primary ui-btn--sm photo-remind-btn" onClick={onTake}>Take my photo</button>}
      </div>
    </div>
  )
}

/** Live camera only (no gallery), front camera; the photo goes straight onto the account. */
export function TakeOwnPhoto({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [shot, setShot] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setShot(null); setError('') } }, [open])

  async function save() {
    if (!shot) return
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/customer/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoUrl: shot }) })
      const d: { error?: string } = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? 'Your photo wasn’t saved. Try again.'); return }
      window.dispatchEvent(new Event(PHOTO_UPDATED))
      onDone()
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={() => { if (!saving) onClose() }} title="Take your photo">
      {open && (
        <>
          <CameraCapture value={shot} onChange={s => { setShot(s); setError('') }} facing="user" subject="your" />
          {error && <p className="ui-field-error ag-center" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
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

/**
 * The photo-deadline pop-up: once per app open, until a photo is on the account. It can always be closed; it comes
 * back the next time the app opens. Quiet when signed out, offline, or with nothing to say.
 */
export default function PhotoReminderPopup({ skip = [] }: { skip?: string[] }) {
  const pathname = usePathname()
  const skipped = skip.some(p => pathname?.startsWith(p))
  const [photo, setPhoto] = useState<CustomerPhoto | null>(null)
  const [open, setOpen] = useState(false)
  const [camera, setCamera] = useState(false)

  useEffect(() => {
    if (skipped) return
    let closed = false
    try { closed = sessionStorage.getItem(DISMISSED) === '1' } catch { /* storage blocked: show it */ }
    if (closed) return
    let alive = true
    fetch('/api/customer/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { photo?: CustomerPhoto } | null) => {
        if (!alive || !d?.photo || !customerPhotoCopy(d.photo)) return
        setPhoto(d.photo); setOpen(true)
      })
      .catch(() => {})
    return () => { alive = false }
    // Once per app open or sign-in, not on every page change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipped])

  function close() {
    setOpen(false)
    try { sessionStorage.setItem(DISMISSED, '1') } catch { /* it just shows again next page load */ }
  }

  const copy = photo ? customerPhotoCopy(photo) : null
  return (
    <>
      <BottomSheet open={open && !!copy} onClose={close} title={copy?.title ?? ''}>
        {copy && (
          <div className={`photo-remind-sheet photo-remind--${copy.tone}`}>
            <p className="photo-remind-text">{copy.text}</p>
            {copy.camera && <button type="button" className="ui-btn ui-btn--primary ui-btn--block ui-gap-top" onClick={() => { setOpen(false); setCamera(true) }}>Take my photo</button>}
            <button type="button" className={`ui-btn ${copy.camera ? 'ui-btn--plain' : 'ui-btn--primary'} ui-btn--block ui-gap-top`} onClick={close}>{copy.camera ? 'Not now' : 'OK'}</button>
          </div>
        )}
      </BottomSheet>
      <TakeOwnPhoto open={camera} onClose={() => { setCamera(false); close() }} onDone={() => { setCamera(false); setPhoto(null); close() }} />
    </>
  )
}

/** The notice plus its camera sheet. Calls onChanged after a photo is added here or from the pop-up. */
export function PhotoNoticeWithCamera({ photo, onChanged }: { photo: CustomerPhoto | null | undefined; onChanged: () => void }) {
  const [camera, setCamera] = useState(false)
  useEffect(() => {
    window.addEventListener(PHOTO_UPDATED, onChanged)
    return () => window.removeEventListener(PHOTO_UPDATED, onChanged)
  }, [onChanged])
  return (
    <>
      <PhotoNotice photo={photo} onTake={() => setCamera(true)} />
      <TakeOwnPhoto open={camera} onClose={() => setCamera(false)} onDone={() => setCamera(false)} />
    </>
  )
}

/** True when a save would be refused: no photo and the deadline has passed. */
export function photoPaused(photo: CustomerPhoto | null | undefined): boolean {
  return !!photo && photo.status !== 'ok' && photo.phase === 'paused'
}

/** For pages that don't load /api/customer/me themselves (Ajo): the photo state, refreshed when a photo is added. */
export function useMyPhoto(): { photo: CustomerPhoto | null; reload: () => void } {
  const [photo, setPhoto] = useState<CustomerPhoto | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    fetch('/api/customer/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { photo?: CustomerPhoto } | null) => { if (alive && d?.photo) setPhoto(d.photo) })
      .catch(() => {})
    return () => { alive = false }
  }, [tick])
  return { photo, reload: () => setTick(t => t + 1) }
}
