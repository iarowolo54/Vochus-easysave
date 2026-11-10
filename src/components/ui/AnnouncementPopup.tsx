'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import BottomSheet from '@/components/ui/BottomSheet'
import PictureSlider from '@/components/ui/PictureSlider'

type Announcement = { id: string; title: string; body: string; imageIds: string[] }

/**
 * Shows super admin's pop-up messages, one after another, every time the person signs in or opens the app. Closing
 * one (OK, the X or Esc) only hides it for this visit. Nothing shows when signed out or offline: the route answers
 * 401 or the fetch fails, and we stay quiet.
 */
export default function AnnouncementPopup({ url, skip = [] }: { url: string; skip?: string[] }) {
  const pathname = usePathname()
  const [queue, setQueue] = useState<Announcement[]>([])
  const content = useRef<HTMLDivElement>(null)
  const skipped = skip.some(p => pathname?.startsWith(p))
  const item = queue[0] ?? null

  useEffect(() => {
    if (skipped) return
    let alive = true
    fetch(url, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { announcements?: Announcement[] } | null) => { if (alive && d?.announcements) setQueue(d.announcements) })
      .catch(() => {})
    return () => { alive = false }
    // Once per app open or sign-in: not again on every page change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, skipped])

  // Each message starts at its top, even when the one before was long enough to scroll.
  useEffect(() => { content.current?.closest('dialog')?.scrollTo({ top: 0 }) }, [item?.id])

  function close() {
    if (!item) return
    setQueue(q => q.slice(1))
    // Only counts who has closed it, so a failure here changes nothing they'd see.
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) }).catch(() => {})
  }

  return (
    <BottomSheet open={!!item} onClose={close} title={item?.title ?? ''}>
      {item && (
        <div ref={content}>
          {item.imageIds.length > 0 && <PictureSlider key={item.id} label={item.title} urls={item.imageIds.map(id => `${url}/image/${id}`)} />}
          {item.body && <p className="ui-announcement-text">{item.body}</p>}
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block ui-gap-top" onClick={close} autoFocus>{queue.length > 1 ? 'Next' : 'OK'}</button>
        </div>
      )}
    </BottomSheet>
  )
}
