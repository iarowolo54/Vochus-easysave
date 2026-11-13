'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icons } from '@/components/ui/icons'
import { resizeImage } from '@/lib/resize-image'

/**
 * Takes a photo with the live camera. By default there is no upload or gallery option: the photo must be taken now, in
 * the app (owner's rule). The server can't prove that (see lib/photo.ts); this is what the app enforces. `allowUpload`
 * adds "Upload photo" beside "Take photo" where the office checks every photo before it's used (an agent adding a
 * photo for one of their customers), the same as the Enrol photo step.
 */
export default function CameraCapture({ value, onChange, facing = 'environment', subject = 'their', allowUpload = false }: {
  value: string | null
  onChange: (dataUrl: string | null) => void
  /** 'user' = front camera (a selfie), 'environment' = back camera (photographing someone else). */
  facing?: 'user' | 'environment'
  /** Whose face, for the captions: 'their' or 'your'. */
  subject?: 'their' | 'your'
  /** Also offer "Upload photo" from the phone's gallery. Only where the office approves the photo first. */
  allowUpload?: boolean
}) {
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCameraActive(false)
  }, [])
  useEffect(() => () => stopCamera(), [stopCamera])

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  }, [cameraActive])

  async function startCamera() {
    setCameraError('')
    onChange(null)
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: 640, height: 480 } })
      setCameraActive(true)
    } catch (e) {
      const denied = (e as { name?: string })?.name === 'NotAllowedError'
      setCameraError(denied
        ? 'Camera access is blocked. Allow the camera for this site in your browser or phone settings, then try again.'
        : 'We couldn’t open the camera. Close other apps using it, then try again.')
    }
  }

  function capture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    onChange(canvas.toDataURL('image/jpeg', 0.9))
    stopCamera()
  }

  // A gallery photo is shrunk first, so a large picture isn't refused by the server's 5 MB limit.
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    stopCamera()
    setCameraError('')
    const data = await resizeImage(file, 900, 0.85)
    if (data) onChange(data)
    else setCameraError('That file isn’t a photo we can use. Choose a JPEG or PNG picture.')
  }

  const uploadButton = allowUpload && (
    <button type="button" className="ui-btn ui-btn--secondary" onClick={() => fileRef.current?.click()}>
      <Icons.image size={18} aria-hidden="true" /> {value ? 'Upload another' : 'Upload photo'}
    </button>
  )

  return (
    <div>
      <div className={`ag-oval${cameraActive ? ' is-live' : ''}${value ? ' has-photo' : ''}`}>
        <video ref={videoRef} autoPlay playsInline muted style={{ display: cameraActive && !value ? 'block' : 'none' }} />
        {value && <img src={value} alt="The photo just taken" />}
        {!cameraActive && !value && <Icons.customers size={56} aria-hidden="true" />}
      </div>
      <p className="ag-oval-caption">
        {value ? `Is ${subject} face clear?` : cameraActive ? `Fit ${subject} face inside the oval` : 'Face the camera, good light, no sunglasses'}
      </p>
      <canvas ref={canvasRef} hidden />
      {cameraError && <p className="ui-field-error ag-center" role="alert"><Icons.error size={16} aria-hidden="true" /> {cameraError}</p>}

      {allowUpload && <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={upload} />}
      <div className={`ag-cam-actions${allowUpload && !cameraActive ? ' ag-cam-pair' : ''}`}>
        {value ? (
          <>
            <button type="button" className="ui-btn ui-btn--secondary" onClick={startCamera}><Icons.retry size={18} aria-hidden="true" /> Take it again</button>
            {uploadButton}
          </>
        ) : cameraActive ? (
          <>
            <button type="button" className="ag-shutter" onClick={capture} aria-label="Take photo"><span /></button>
            <button type="button" className="ui-btn ui-btn--plain" onClick={stopCamera}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className="ui-btn ui-btn--primary" onClick={startCamera}>
              <Icons.camera size={18} aria-hidden="true" /> {cameraError ? 'Try again' : allowUpload ? 'Take photo' : 'Open camera'}
            </button>
            {uploadButton}
          </>
        )}
      </div>
    </div>
  )
}
