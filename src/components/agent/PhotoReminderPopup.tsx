'use client'
import { useEffect, useState } from 'react'
import BottomSheet from '@/components/ui/BottomSheet'
import RetakePhotoSheet from '@/components/agent/RetakePhotoSheet'
import { agentReminderCopy } from '@/lib/photo-copy'
import type { PhotoPhase, PhotoStatus } from '@/lib/photo-deadline'

type Row = { id: string; name: string; customerId: string; photoStatus: PhotoStatus; rejectReason: string | null }
type Reminder = { phase: PhotoPhase; lastDay: string | null; customers: Row[] }
const DISMISSED = 'vochus.agentPhotoReminderClosed'

const statusText = (r: Row) => (r.photoStatus === 'pending' ? 'Photo being checked' : r.photoStatus === 'rejected' ? `Photo rejected: ${r.rejectReason ?? 'take a new one'}` : 'No photo')

/**
 * The agent's photo-deadline pop-up: once per app open while any of their customers needs a photo. Lists them with a
 * Take photo button each. It can always be closed and comes back next time.
 */
export default function PhotoReminderPopup() {
  const [data, setData] = useState<Reminder | null>(null)
  const [open, setOpen] = useState(false)
  const [photoFor, setPhotoFor] = useState<Row | null>(null)

  useEffect(() => {
    let closed = false
    try { closed = sessionStorage.getItem(DISMISSED) === '1' } catch { /* storage blocked: show it */ }
    if (closed) return
    let alive = true
    fetch('/api/agent/photo-reminder', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: Reminder | null) => {
        if (!alive || !d || !agentReminderCopy({ phase: d.phase, lastDay: d.lastDay, count: d.customers.length })) return
        setData(d); setOpen(true)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  function close() {
    setOpen(false)
    try { sessionStorage.setItem(DISMISSED, '1') } catch { /* shows again next page load */ }
  }

  const copy = data ? agentReminderCopy({ phase: data.phase, lastDay: data.lastDay, count: data.customers.length }) : null
  return (
    <>
      <BottomSheet open={open && !!copy && !photoFor} onClose={close} title={copy?.title ?? ''}>
        {copy && data && (
          <div className={`photo-remind-sheet photo-remind--${copy.tone}`}>
            <p className="photo-remind-text">{copy.text}</p>
            <ul className="photo-remind-list">
              {data.customers.map(r => (
                <li key={r.id}>
                  <div className="photo-remind-who">
                    <span className="ui-row-title">{r.name}</span>
                    <span className={`photo-tag photo-tag--${r.photoStatus}`}>{statusText(r)}</span>
                  </div>
                  {r.photoStatus !== 'pending' && <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setPhotoFor(r)}>Take photo</button>}
                </li>
              ))}
            </ul>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--block ui-gap-top" onClick={close}>OK</button>
          </div>
        )}
      </BottomSheet>
      <RetakePhotoSheet
        customer={photoFor && { id: photoFor.id, name: photoFor.name, hasPhoto: false }}
        onClose={() => setPhotoFor(null)}
        onSubmitted={() => {
          const id = photoFor?.id
          setData(d => d && { ...d, customers: d.customers.map(c => (c.id === id ? { ...c, photoStatus: 'pending', rejectReason: null } : c)) })
        }}
      />
    </>
  )
}
