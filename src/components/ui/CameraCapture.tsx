'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icons } from '@/components/ui/icons'

/**
 * Takes a photo with the live camera. There is deliberately no upload or gallery option: the photo must be
 * taken now, in the app (owner's rule). The server can't prove that (see lib/photo.ts); this is what the app enforces.
 */
export default function CameraCapture({ value, onChange, facing = 'environment', subject = 'their' }: {
  value: string | null
  onChange: (dataUrl: string | null) => void
  /** 'user' = front camera (a selfie), 'environment' = back camera (photographing someone else). */
  facing?: 'user' | 'environment'
  /** Whose face, for the captions: 'their' or 'your'. */
  subject?: 'their' | 'your'
}) {
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
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

      <div className="ag-cam-actions">
        {value ? (
          <button type="button" className="ui-btn ui-btn--secondary" onClick={startCamera}><Icons.retry size={18} aria-hidden="true" /> Take it again</button>
        ) : cameraActive ? (
          <>
            <button type="button" className="ag-shutter" onClick={capture} aria-label="Take photo"><span /></button>
            <button type="button" className="ui-btn ui-btn--plain" onClick={stopCamera}>Cancel</button>
          </>
        ) : (
          <button type="button" className="ui-btn ui-btn--primary" onClick={startCamera}>
            <Icons.image size={18} aria-hidden="true" /> {cameraError ? 'Try again' : 'Open camera'}
          </button>
        )}
      </div>
    </div>
  )
}
