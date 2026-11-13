'use client'
// Take photo | Upload photo side by side, for the agent's "No photo" / "Saving is paused" cards. Take photo opens the
// photo sheet's camera; Upload photo opens the phone's gallery at once and hands the (shrunk) picture to the sheet,
// ready to send for checking. Agents may upload: the office checks every photo before it's used (src/lib/photo.ts).
import { useRef, useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { resizeImage } from '@/lib/resize-image'

export default function PhotoButtons({ onTake, onUpload }: {
  onTake: () => void
  /** A JPEG data URL, already shrunk so the server's 5 MB limit can't refuse it. */
  onUpload: (dataUrl: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  async function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    const data = await resizeImage(file, 900, 0.85)
    if (data) onUpload(data)
    else setError('That file isn’t a photo we can use. Choose a JPEG or PNG picture.')
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={picked} />
      <div className="photo-remind-actions">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={onTake}>
          <Icons.camera size={16} aria-hidden="true" /> Take photo
        </button>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => fileRef.current?.click()}>
          <Icons.image size={16} aria-hidden="true" /> Upload photo
        </button>
      </div>
      {error && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {error}</p>}
    </>
  )
}
