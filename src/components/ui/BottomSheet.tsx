'use client'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icons } from './icons'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/** Slide-up panel on phones, centred dialog on wide screens. Native <dialog> gives Esc-to-close and focus trapping. */
export default function BottomSheet({ open, onClose, title, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="ui-sheet"
      aria-labelledby={titleId}
      // A sheet opened inside this one (a bank list, say) closes without closing this one.
      onClose={e => { if (e.target === ref.current) onClose() }}
      // A click on the dialog element itself (not its content) is a click on the backdrop.
      onClick={e => { if (e.target === ref.current) onClose() }}
    >
      <div className="ui-sheet-inner">
        <div className="ui-sheet-head">
          <h2 id={titleId} className="ui-card-title">{title}</h2>
          <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={onClose} aria-label="Close">
            <Icons.close size={20} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
