'use client'
import { useEffect } from 'react'
import { Icons } from './icons'

/** Brief confirmation at the top of the screen (e.g. "₦500 added to your savings"). */
export default function Toast({ message, onDone, ms = 5000 }: { message: string; onDone: () => void; ms?: number }) {
  useEffect(() => {
    const t = setTimeout(onDone, ms)
    return () => clearTimeout(t)
  }, [onDone, ms])
  return (
    <div className="ui-toast" role="status">
      <Icons.check size={18} aria-hidden="true" />
      <span>{message}</span>
      <button type="button" className="ui-toast-close" onClick={onDone} aria-label="Dismiss">
        <Icons.close size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
