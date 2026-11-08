'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import BottomSheet from '@/components/ui/BottomSheet'

type Announcement = { id: string; title: string; body: string }

/**
 * Shows super admin's pop-up message once when the app opens, until the person closes it (OK, the X or Esc all
 * count). Nothing shows when signed out or offline: the route answers 401 or the fetch fails, and we stay quiet.
 */
export default function AnnouncementPopup({ url, skip = [] }: { url: string; skip?: string[] }) {
  const pathname = usePathname()
  const [item, setItem] = useState<Announcement | null>(null)
  const skipped = skip.some(p => pathname?.startsWith(p))

  useEffect(() => {
    if (skipped) return
    let alive = true
    fetch(url, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { announcement?: Announcement | null } | null) => { if (alive && d?.announcement) setItem(d.announcement) })
      .catch(() => {})
    return () => { alive = false }
    // Once per app open: not again on every page change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, skipped])

  function close() {
    const shown = item
    setItem(null)
    if (!shown) return
    // Best effort: if this fails they may see it once more next time, which is harmless.
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: shown.id }) }).catch(() => {})
  }

  return (
    <BottomSheet open={!!item} onClose={close} title={item?.title ?? ''}>
      {item && (
        <>
          <p className="ui-announcement-text">{item.body}</p>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block ui-gap-top" onClick={close} autoFocus>OK</button>
        </>
      )}
    </BottomSheet>
  )
}
