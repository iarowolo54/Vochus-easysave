'use client'
import { useEffect, useState } from 'react'
import { Icons } from './icons'

/** Tells people when amounts on screen may be out of date because the phone is offline. */
export default function OfflineNotice() {
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  if (!offline) return null
  return (
    <div className="ui-offline" role="status">
      <Icons.error size={16} aria-hidden="true" />
      You’re offline. Amounts may be out of date until you reconnect.
    </div>
  )
}
