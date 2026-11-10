'use client'

import { feeSentence } from '@/lib/savings-fee'
import { usePlanFees } from '@/lib/use-plan-fees'
import { useFlexibleTerms } from '@/lib/use-flexible-terms'
import { earliestEnd } from '@/lib/flexible-savings'
import { useState, useRef, useEffect, useCallback, type ChangeEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { blockMinus, blockNonDigit, digitsOnly, nonNegativeString } from '@/lib/numeric'
import { displayName, formatNaira } from '@/lib/format'
import { addDays, isoDate, MAX_PLAN_DAYS, parseDateInput, today } from '@/lib/plan-dates'
import EmptyState from '@/components/ui/EmptyState'
import { NG_STATES, lgasOf } from '@/lib/ng-lgas'
import DatePicker from '@/components/ui/DatePicker'
import EndDateField, { endDateDays } from '@/components/ui/EndDateField'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { REGISTRATION_FEE } from '@/lib/wallet-rates'

type Cadence = 'daily' | 'weekly' | 'monthly' | 'flexible'
type FixedCadence = Exclude<Cadence, 'flexible'>

interface PlanDraft {
  dailyAmount: string; periodDays: string; goal: string; startDate: string; notes: string; cadence: Cadence
  /** Flexible plans only: the chosen end date, yyyy-mm-dd. */
  endDate: string
}

interface FormData {
  firstName: string; lastName: string; gender: string; phone: string; email: string; dob: string
  address: string; state: string; lga: string; language: string; bvn: string
  nokName: string; nokRelation: string; nokPhone: string
  dailyAmount: string; periodDays: string; goal: string; startDate: string; notes: string; cadence: Cadence; endDate: string
  plans: PlanDraft[]
  agreed: boolean
  nfcCard: string
}

const empty: FormData = {
  firstName: '', lastName: '', gender: '', phone: '', email: '', dob: '',
  address: '', state: '', lga: '', language: 'English', bvn: '',
  nokName: '', nokRelation: 'Spouse', nokPhone: '',
  dailyAmount: '', periodDays: '', goal: '', startDate: '', notes: '', cadence: 'daily', endDate: '',
  plans: [],
  agreed: false,
  nfcCard: '',
}

const STEPS = ['Personal details', 'Photo', 'Savings plan', 'Card and fee', 'Review']
const GOALS = ['School Fees', 'Business Capital', 'House Rent', 'Medical Expenses', 'Wedding / Event', 'Other']
const PERIODS: Record<FixedCadence, [string, string][]> = {
  daily: [['31', '31 days'], ['62', '62 days'], ['93', '93 days'], ['186', '186 days'], ['365', '365 days']],
  weekly: [['28', '4 weeks'], ['56', '8 weeks'], ['84', '12 weeks'], ['168', '24 weeks'], ['364', '52 weeks']],
  monthly: [['30', '1 month'], ['60', '2 months'], ['90', '3 months'], ['180', '6 months'], ['365', '12 months']],
}
const UNIT: Record<Cadence, string> = { daily: 'a day', weekly: 'a week', monthly: 'a month', flexible: '' }

/** Plans are entered per day / week / month; the API stores the daily equivalent. */
function dailyEquiv(amount: string, cadence: Cadence) {
  const ra = parseFloat(amount || '0')
  return cadence === 'weekly' ? ra / 7 : cadence === 'monthly' ? ra / 30 : ra
}
function planTarget(p: Pick<PlanDraft, 'dailyAmount' | 'periodDays' | 'cadence'>) {
  if (p.cadence === 'flexible') return 0
  return Math.round(dailyEquiv(p.dailyAmount, p.cadence) * parseInt(p.periodDays || '0'))
}
function periodLabel(p: Pick<PlanDraft, 'periodDays' | 'cadence'>) {
  const days = parseInt(p.periodDays || '0')
  return p.cadence === 'weekly' ? `${days / 7} weeks` : p.cadence === 'monthly' ? `${Math.round(days / 30)} months` : `${days} days`
}
function maturity(p: Pick<PlanDraft, 'startDate' | 'periodDays' | 'cadence' | 'endDate'>) {
  if (p.cadence === 'flexible') {
    const end = parseDateInput(p.endDate)
    return end ? end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  }
  if (!p.periodDays) return ''
  const d = p.startDate ? new Date(p.startDate) : new Date()
  d.setDate(d.getDate() + parseInt(p.periodDays))
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The longest side of an uploaded photo; a phone's full-size picture would bloat the record for no gain. */
const MAX_PHOTO_SIDE = 1000

/** What the agent typed for a plan, from the daily equivalent the request stores. */
function enteredAmount(daily: number, cadence: Cadence) {
  const factor = cadence === 'weekly' ? 7 : cadence === 'monthly' ? 30 : 1
  return cadence === 'flexible' ? '' : String(Math.round(daily * factor * 100) / 100)
}

export default function EnrolPage() {
  const fees = usePlanFees()
  const terms = useFlexibleTerms()
  const router = useRouter()
  const { data: session, status: sessionStatus } = useSession()
  const walletBalance = (session?.user as { walletBalance?: number } | undefined)?.walletBalance ?? 0
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormData>(empty)
  /** A chosen end date ("yyyy-mm-dd") for the plan being filled in, instead of a set length. */
  const [customEnd, setCustomEnd] = useState('')
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)
  const [sent, setSent] = useState<{ name: string } | null>(null)
  /** Fixing a denied request: its id and what the office said. */
  const [fixing, setFixing] = useState<{ id: string; reason: string; fix: string } | null>(null)
  const [fixLoad, setFixLoad] = useState<'idle' | 'loading' | 'error'>('idle')
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [showMissing, setShowMissing] = useState(false)
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // QR scanner state
  const [qrScanActive, setQrScanActive] = useState(false)
  const [qrStreamReady, setQrStreamReady] = useState(false)
  const [qrError, setQrError] = useState('')
  const qrVideoRef = useRef<HTMLVideoElement>(null)
  const qrStreamRef = useRef<MediaStream | null>(null)
  const qrAnimRef = useRef<number>(0)

  const set = <K extends keyof FormData>(k: K, v: FormData[K]) => setForm(f => ({ ...f, [k]: v }))

  async function startQrScan() {
    setQrError('')
    setQrStreamReady(false)
    setQrScanActive(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      qrStreamRef.current = stream
      setQrStreamReady(true)
    } catch {
      setQrError('The camera couldn’t be opened. Type the card serial instead.')
      setQrScanActive(false)
    }
  }

  function stopQrScan() {
    cancelAnimationFrame(qrAnimRef.current)
    qrStreamRef.current?.getTracks().forEach(t => t.stop())
    qrStreamRef.current = null
    setQrStreamReady(false)
    setQrScanActive(false)
  }

  useEffect(() => {
    if (!qrStreamReady || !qrVideoRef.current || !qrStreamRef.current) return
    const video = qrVideoRef.current
    video.srcObject = qrStreamRef.current
    video.setAttribute('playsinline', 'true')
    video.muted = true
    video.play().catch(() => {})

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    let running = true

    function tick() {
      if (!running) return
      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        import('jsqr').then(({ default: jsQR }) => {
          const code = jsQR(imageData.data, imageData.width, imageData.height)
          if (code?.data) {
            set('nfcCard', code.data)
            stopQrScan()
          }
        })
      }
      qrAnimRef.current = requestAnimationFrame(tick)
    }
    qrAnimRef.current = requestAnimationFrame(tick)
    return () => { running = false; cancelAnimationFrame(qrAnimRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrStreamReady])

  useEffect(() => () => { qrStreamRef.current?.getTracks().forEach(t => t.stop()) }, [])

  // Fixing a denied request: fill the form with what was sent. Read here, not with useSearchParams, so the page needs no Suspense.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('request')
    if (!id) return
    setFixLoad('loading')
    fetch(`/api/customers/requests/${encodeURIComponent(id)}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(r => {
        if (r.status !== 'Denied') throw new Error()
        const todayIso = isoDate(today())
        setForm(f => ({
          ...f,
          firstName: r.firstName, lastName: r.lastName, gender: r.gender, phone: r.phone, email: r.email ?? '',
          dob: r.dob ? isoDate(new Date(r.dob)) : '', address: r.address, state: r.state, lga: r.lga, language: r.language, bvn: r.bvn ?? '',
          nokName: r.nokName, nokRelation: r.nokRelation || 'Spouse', nokPhone: r.nokPhone, nfcCard: r.nfcCard ?? '',
          plans: (r.plans as { dailyAmount: number; periodDays: number; goal: string; startDate: string; notes: string | null; cadence: Cadence; endDate: string | null }[]).map(p => ({
            dailyAmount: enteredAmount(p.dailyAmount, p.cadence),
            periodDays: p.cadence === 'flexible' ? '' : String(p.periodDays),
            goal: p.goal, startDate: p.startDate < todayIso ? todayIso : p.startDate, notes: p.notes ?? '', cadence: p.cadence, endDate: p.endDate ?? '',
          })),
        }))
        setPhotoDataUrl(r.photoUrl ?? null)
        setFixing({ id: r.id, reason: r.denyReason ?? '', fix: r.denyFix ?? '' })
        setFixLoad('idle')
      })
      .catch(() => setFixLoad('error'))
  }, [])

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  }, [cameraActive])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCameraActive(false)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  async function startCamera() {
    setCameraError('')
    setPhotoDataUrl(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: 640, height: 480 } })
      streamRef.current = stream
      setCameraActive(true)
    } catch (e) {
      const denied = (e as { name?: string })?.name === 'NotAllowedError'
      setCameraError(denied
        ? 'Camera access is blocked. Upload a photo instead, or allow the camera in your phone settings.'
        : 'We couldn’t open the camera. Upload a photo instead, or close other apps using it.')
    }
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.9))
    stopCamera()
  }

  function retake() {
    setPhotoDataUrl(null)
    startCamera()
  }

  /** Shrinks the picked picture to a sensible size and turns it into the same kind of image the camera gives. */
  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setCameraError('')
    if (!file.type.startsWith('image/')) { setCameraError('Choose a photo.'); return }
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('decode')); img.src = url })
      const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      stopCamera()
      setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.85))
    } catch {
      setCameraError('That photo couldn’t be opened. Try another one.')
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  function go(n: number) {
    setError('')
    setStep(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const planStart = parseDateInput(form.startDate) ?? today()
  const isFlex = form.cadence === 'flexible'
  /** The fixed-plan cadence the amount and length fields use (unused while Flexible is picked). */
  const fixed: FixedCadence = form.cadence === 'flexible' ? 'daily' : form.cadence
  const minEnd = earliestEnd(planStart, terms)
  const flexEnd = parseDateInput(form.endDate)
  const flexEndError = !flexEnd ? '' : flexEnd < minEnd ? `Pick ${maturity({ ...form, endDate: isoDate(minEnd) })} or later (at least ${terms.minTermMonths} months).` : ''
  const draftHasAny = !!(form.dailyAmount || form.periodDays || form.goal || form.endDate)
  const draftValid = isFlex ? !!(form.goal && flexEnd && !flexEndError) : !!(form.dailyAmount && form.periodDays && form.goal)

  // The terms line on the review step: the fee of the first fixed plan (as before), and the flexible charges if any plan is flexible.
  const firstFixed = form.plans.find(p => p.cadence !== 'flexible')
  const reviewFees = [
    firstFixed ? feeSentence({ live: fees.live, cadence: firstFixed.cadence, amountPerPayment: parseFloat(firstFixed.dailyAmount) || 0, periodicFeePct: fees.periodicFeePct }) : '',
    form.plans.some(p => p.cadence === 'flexible')
      ? `${firstFixed ? 'On the flexible plan: ' : ''}${feeSentence({ live: true, cadence: 'flexible', amountPerPayment: 0, periodicFeePct: 0, flexible: { cashCommissionPct: terms.cashCommissionPct, penaltyPct: terms.penaltyPct, online: false } })}`
      : '',
  ].filter(Boolean).join(' ')

  function addDraftPlan() {
    setForm(f => ({
      ...f,
      plans: [...f.plans, f.cadence === 'flexible'
        ? { dailyAmount: '', periodDays: '', goal: f.goal, startDate: f.startDate || isoDate(today()), notes: f.notes, cadence: f.cadence, endDate: f.endDate }
        : { dailyAmount: f.dailyAmount, periodDays: f.periodDays, goal: f.goal, startDate: f.startDate || isoDate(today()), notes: f.notes, cadence: f.cadence, endDate: '' }],
      dailyAmount: '', periodDays: '', goal: '', startDate: '', notes: '', cadence: 'daily', endDate: '',
    }))
    setCustomEnd('')
  }

  async function submit() {
    if (submittingRef.current) return
    if (!form.agreed) { setError('Tick the box to confirm the customer agreed to the terms.'); return }
    submittingRef.current = true
    setLoading(true)
    setError('')
    try {
      const res = await fetch(fixing ? `/api/customers/requests/${encodeURIComponent(fixing.id)}` : '/api/customers/requests', {
        method: fixing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName, lastName: form.lastName, gender: form.gender, phone: form.phone, email: form.email, dob: form.dob,
          address: form.address, state: form.state, lga: form.lga, language: form.language, bvn: form.bvn,
          nokName: form.nokName, nokRelation: form.nokRelation, nokPhone: form.nokPhone, nfcCard: form.nfcCard,
          photoUrl: photoDataUrl,
          plans: form.plans.map(p => ({ ...p, dailyAmount: String(dailyEquiv(p.dailyAmount, p.cadence)) })),
        }),
      })
      let data: { error?: string; id?: string } | null = null
      try { data = await res.json() } catch { data = null }
      if (!res.ok || !data?.id) {
        setError(data?.error || 'The request couldn’t be sent. Please try again.')
        submittingRef.current = false
        setLoading(false)
        return
      }
      setSent({ name: displayName(`${form.firstName} ${form.lastName}`) })
      setLoading(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError('We lost the connection. Check your customer requests before trying again.')
      submittingRef.current = false
      setLoading(false)
    }
  }

  const fullName = displayName(`${form.firstName} ${form.lastName}`.trim())
  const req1 = { firstName: form.firstName, lastName: form.lastName, gender: form.gender, phone: form.phone, address: form.address, state: form.state, lga: form.lga }
  const missing = (k: keyof typeof req1) => showMissing && !req1[k]
  const phoneShort = showMissing && form.phone.length > 0 && form.phone.length < 11

  // ── Blocking states ──

  if (fixLoad === 'loading') {
    return <div className="ag-page"><section className="ui-card ag-flow-block"><span className="ui-spinner" role="status" aria-label="Loading the request" /></section></div>
  }
  if (fixLoad === 'error') {
    return (
      <div className="ag-page">
        <section className="ui-card ag-flow-block">
          <EmptyState icon="error" title="This request can’t be opened" text="It may already have been sent again."
            action={<Link href="/dashboard/customers/requests" className="ui-btn ui-btn--primary">See your requests</Link>} />
        </section>
      </div>
    )
  }

  if (sessionStatus === 'authenticated' && walletBalance <= 0 && !sent) {
    return (
      <div className="ag-page">
        <section className="ui-card ag-flow-block">
          <EmptyState icon="wallet" title="Fund your wallet first"
            text="Enrolling a customer needs money in your agent wallet. Top up, then come back to enrol."
            action={
              <div className="ui-stack ag-flow-block-actions">
                <Link href={`/dashboard/wallet?return=${encodeURIComponent('/dashboard/enrol')}`} className="ui-btn ui-btn--primary">Add money to wallet</Link>
                <button type="button" className="ui-btn ui-btn--plain" onClick={() => router.back()}>Go back</button>
              </div>
            } />
        </section>
      </div>
    )
  }

  if (sent) {
    return (
      <div className="ag-page">
        <section className="ui-card ag-done ag-flow-done" aria-live="polite">
          {photoDataUrl
            ? <img src={photoDataUrl} alt="" className="ag-flow-done-photo" />
            : <span className="ag-topup-icon" aria-hidden="true"><Icons.check size={22} /></span>}
          <span className="ui-status ui-status--success ui-status--lg"><Icons.check size={16} aria-hidden="true" /> Sent for approval</span>
          <p className="ag-flow-done-name">{sent.name}</p>
          <p className="ui-row-sub">You’ll be told when it’s approved or denied.</p>
          <div className="ag-done-actions">
            <Link href="/dashboard/customers/requests" className="ui-btn ui-btn--primary ui-btn--block">See your requests</Link>
            <button type="button" className="ui-btn ui-btn--plain ui-btn--block" onClick={() => {
              window.history.replaceState(null, '', '/dashboard/enrol')
              setForm(empty); setPhotoDataUrl(null); setFixing(null)
              setShowMissing(false); setSent(null); submittingRef.current = false; setStep(1)
            }}>Enrol another customer</button>
          </div>
        </section>
      </div>
    )
  }

  // ── Flow ──

  const question: Record<number, string> = {
    1: 'Who are you enrolling?',
    2: 'Add their passport photograph',
    3: form.plans.length > 0 ? 'Add another plan, or continue' : 'Set up their savings plan',
    4: 'Card and registration fee',
    5: 'Check before you send',
  }
  const lead: Record<number, ReactNode> = {
    1: 'Use their legal name and the phone number they use every day.',
    2: 'A clear photo of their face. The office checks it before approving.',
    3: 'How much they save, how often, and for how long.',
    4: 'Link their savings card now or later.',
    5: 'Make sure everything is right. You can edit any part.',
  }
  const dirty = !!(form.firstName || form.lastName || form.phone || photoDataUrl || form.plans.length)

  function back() {
    if (step === 2) stopCamera()
    go(step - 1)
  }

  return (
    <div className="ag-page">
      <div className="ag-flow">
        <div className="ag-flow-main">
          <header className="ag-flow-head">
            <div className="ag-flow-nav">
              {step > 1
                ? <button type="button" className="ui-icon-btn ui-icon-btn--soft" onClick={back} aria-label="Back"><Icons.back size={20} aria-hidden="true" /></button>
                : <span className="ag-flow-nav-gap" />}
              <span className="ag-flow-count">Step {step} of {STEPS.length} · {STEPS[step - 1]}</span>
              <button type="button" className="ui-icon-btn ui-icon-btn--soft" aria-label="Stop enrolling"
                onClick={() => { if (!dirty || window.confirm('Stop enrolling? What you’ve entered will be lost.')) router.push('/dashboard/customers') }}>
                <Icons.close size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="ag-flow-line" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step} aria-label={`Step ${step} of ${STEPS.length}`}>
              <span style={{ width: `${(step / STEPS.length) * 100}%` }} />
            </div>
          </header>

          <div className="ag-flow-body">
            <h2 className="ag-q">{question[step]}</h2>
            <p className="ag-q-lead">{lead[step]}</p>

            <FormError message={error} />

            {fixing && step === 1 && (
              <div className="ui-banner ui-banner--danger" role="status">
                <Icons.error size={18} aria-hidden="true" />
                <div>
                  <p><strong>Why it was denied:</strong> {fixing.reason}</p>
                  <p><strong>What to work on:</strong> {fixing.fix}</p>
                </div>
              </div>
            )}

            {/* 1 — Personal details */}
            {step === 1 && (
              <>
                <div className="ag-grid-2">
                  <Field id="fn" label="First name" required error={missing('firstName') ? 'Enter their first name' : ''}>
                    <input id="fn" className="ag-tf-input" autoComplete="off" value={form.firstName}
                      aria-invalid={missing('firstName') || undefined} onChange={e => set('firstName', e.target.value)} />
                  </Field>
                  <Field id="ln" label="Last name" required error={missing('lastName') ? 'Enter their last name' : ''}>
                    <input id="ln" className="ag-tf-input" autoComplete="off" value={form.lastName}
                      aria-invalid={missing('lastName') || undefined} onChange={e => set('lastName', e.target.value)} />
                  </Field>
                </div>
                <div className="ag-tf-wrap">
                  <p className="ag-label" id="gd-label">Gender <span className="ag-req" aria-hidden="true">*</span></p>
                  <div className="ag-goal-chips ag-gender" role="radiogroup" aria-labelledby="gd-label" aria-describedby={missing('gender') ? 'gd-error' : undefined}>
                    {['Female', 'Male'].map(g => (
                      <button key={g} type="button" role="radio" aria-checked={form.gender === g} className="ag-chip" onClick={() => set('gender', g)}>{g}</button>
                    ))}
                  </div>
                  {missing('gender') && <FieldError id="gd-error" message="Choose their gender" />}
                </div>
                <Field id="ph" label="Phone number" required
                  error={missing('phone') ? 'Enter their phone number' : phoneShort ? 'Phone numbers have 11 digits' : ''}>
                  <input id="ph" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" maxLength={11} placeholder="080 0000 0000"
                    value={form.phone} aria-invalid={missing('phone') || phoneShort || undefined} onKeyDown={blockNonDigit} onChange={e => set('phone', digitsOnly(e.target.value).slice(0, 11))} />
                </Field>
                <Field id="addr" label="Home address" required error={missing('address') ? 'Enter their address' : ''}>
                  <input id="addr" className="ag-tf-input" placeholder="Street, area, city" value={form.address}
                    aria-invalid={missing('address') || undefined} onChange={e => set('address', e.target.value)} />
                </Field>
                <div className="ag-grid-2">
                  <Field id="st" label="State" required error={missing('state') ? 'Choose a state' : ''}>
                    <select id="st" className="ag-tf-input ag-tf-select" value={form.state} aria-invalid={missing('state') || undefined} onChange={e => setForm(f => ({ ...f, state: e.target.value, lga: '' }))}>
                      <option value="">Choose</option>
                      {NG_STATES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field id="lga" label="Local government" required error={missing('lga') ? (form.state ? 'Choose their LGA' : 'Choose a state first') : ''}>
                    <select id="lga" className="ag-tf-input ag-tf-select" value={form.lga} disabled={!form.state} aria-invalid={missing('lga') || undefined} onChange={e => set('lga', e.target.value)}>
                      <option value="">{form.state ? 'Choose' : 'Choose a state first'}</option>
                      {lgasOf(form.state).map(l => <option key={l}>{l}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="ag-grid-2">
                  <Field id="lang" label="Language">
                    <select id="lang" className="ag-tf-input ag-tf-select" value={form.language} onChange={e => set('language', e.target.value)}>
                      <option>English</option><option>Yoruba</option><option>Igbo</option><option>Hausa</option>
                    </select>
                  </Field>
                </div>

                <h3 className="ag-sub">Next of kin <span>Optional</span></h3>
                <Field id="nok" label="Full name">
                  <input id="nok" className="ag-tf-input" value={form.nokName} onChange={e => set('nokName', e.target.value)} />
                </Field>
                <div className="ag-grid-2">
                  <Field id="nokr" label="Relationship">
                    <select id="nokr" className="ag-tf-input ag-tf-select" value={form.nokRelation} onChange={e => set('nokRelation', e.target.value)}>
                      <option>Spouse</option><option>Parent</option><option>Sibling</option><option>Friend</option>
                    </select>
                  </Field>
                  <Field id="nokp" label="Phone">
                    <input id="nokp" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" maxLength={11}
                      value={form.nokPhone} onKeyDown={blockNonDigit} onChange={e => set('nokPhone', digitsOnly(e.target.value).slice(0, 11))} />
                  </Field>
                </div>

                <details className="ag-more" open={!!(form.dob || form.email || form.bvn)}>
                  <summary>More details <span>Optional</span><Icons.expand size={18} aria-hidden="true" /></summary>
                  <div className="ag-grid-2">
                    <div className="ui-field">
                      <label className="ui-label" htmlFor="dob">Date of birth</label>
                      <DatePicker id="dob" ariaLabel="Date of birth" sheetTitle="Pick their date of birth" allowEmpty yearPicker
                        emptyViewIso={`${new Date().getFullYear() - 30}-01-01`} maxIso={isoDate(today())} value={form.dob} onChange={iso => set('dob', iso)} />
                    </div>
                    <Field id="em" label="Email">
                      <input id="em" className="ag-tf-input" type="email" inputMode="email" value={form.email} onChange={e => set('email', e.target.value)} />
                    </Field>
                  </div>
                  <Field id="bvn" label="BVN">
                    <input id="bvn" className="ag-tf-input ag-tf-num" inputMode="numeric" maxLength={11} value={form.bvn} onChange={e => set('bvn', e.target.value)} />
                  </Field>
                </details>

                <FlowActions primary={<button type="button" className="ui-btn ui-btn--primary ag-flow-cta" onClick={() => {
                  if (!form.firstName || !form.lastName || !form.gender || !form.phone || form.phone.length < 11 || !form.address || !form.state || !form.lga) {
                    setShowMissing(true)
                    setError('Some details are missing. Check the fields marked in red.')
                    return
                  }
                  setShowMissing(false)
                  go(2)
                }}>Continue</button>} />
              </>
            )}

            {/* 2 — Photo */}
            {step === 2 && (
              <>
                <div className={`ag-oval${cameraActive ? ' is-live' : ''}${photoDataUrl ? ' has-photo' : ''}`}>
                  <video ref={videoRef} autoPlay playsInline muted style={{ display: cameraActive && !photoDataUrl ? 'block' : 'none' }} />
                  {photoDataUrl && <img src={photoDataUrl} alt="Customer photo" />}
                  {!cameraActive && !photoDataUrl && <Icons.customers size={56} aria-hidden="true" />}
                  {photoDataUrl && <span className="ag-oval-ok" aria-hidden="true"><Icons.check size={18} /></span>}
                </div>
                <p className="ag-oval-caption">
                  {photoDataUrl ? 'Looks good. Retake it if the face isn’t clear.' : cameraActive ? 'Fit their face inside the oval' : 'Face the camera, good light, no sunglasses'}
                </p>
                <canvas ref={canvasRef} hidden />
                {cameraError && <p className="ui-field-error ag-center" role="alert"><Icons.error size={16} aria-hidden="true" /> {cameraError}</p>}

                <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
                <div className="ag-cam-actions">
                  {photoDataUrl ? (
                    <>
                      <button type="button" className="ui-btn ui-btn--secondary" onClick={retake}><Icons.retry size={18} aria-hidden="true" /> Retake</button>
                      <button type="button" className="ui-btn ui-btn--plain" onClick={() => fileRef.current?.click()}>Upload another</button>
                    </>
                  ) : cameraActive ? (
                    <>
                      <button type="button" className="ag-shutter" onClick={capturePhoto} aria-label="Take photo"><span /></button>
                      <button type="button" className="ui-btn ui-btn--plain" onClick={stopCamera}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" className="ui-btn ui-btn--secondary" onClick={() => fileRef.current?.click()}>Upload a photo</button>
                  )}
                </div>

                <FlowActions primary={photoDataUrl
                  ? <button type="button" className="ui-btn ui-btn--primary ag-flow-cta" onClick={() => { stopCamera(); go(3) }}>Continue</button>
                  : cameraActive
                    ? <button type="button" className="ui-btn ui-btn--primary ag-flow-cta" onClick={capturePhoto}>Take photo</button>
                    : <button type="button" className="ui-btn ui-btn--primary ag-flow-cta" onClick={startCamera}><Icons.image size={18} aria-hidden="true" /> {cameraError ? 'Try again' : 'Open camera'}</button>} />
              </>
            )}

            {/* 3 — Savings plan */}
            {step === 3 && (
              <>
                {form.plans.length > 0 && (
                  <ul className="ag-added" aria-label="Plans added">
                    {form.plans.map((p, i) => (
                      <li key={i}>
                        <span className="ag-added-icon" aria-hidden="true"><Icons.plan size={20} /></span>
                        <span className="ag-payee-main">
                          <span className="ui-row-title ui-block">{p.goal}</span>
                          <span className="ui-row-sub ui-block">{p.cadence === 'flexible' ? `Flexible · any amount until ${maturity(p)}` : `${formatNaira(parseFloat(p.dailyAmount || '0'), { minor: false })} ${UNIT[p.cadence]} · ${periodLabel(p)} · ${formatNaira(planTarget(p), { minor: false })} target`}</span>
                        </span>
                        <button type="button" className="ui-icon-btn ui-icon-btn--soft" aria-label={`Remove ${p.goal} plan`}
                          onClick={() => setForm(f => ({ ...f, plans: f.plans.filter((_, j) => j !== i) }))}>
                          <Icons.close size={18} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <p className="ag-label" id="goal">What are they saving for?</p>
                <div className="ag-goal-chips" role="group" aria-labelledby="goal">
                  {GOALS.map(g => (
                    <button key={g} type="button" className="ag-chip" aria-pressed={form.goal === g} onClick={() => set('goal', g)}>{g}</button>
                  ))}
                </div>

                <p className="ag-label" id="cad">How often?</p>
                <div className="ui-segment ag-seg" role="group" aria-labelledby="cad">
                  {(['daily', 'weekly', 'monthly', 'flexible'] as const).map(c => (
                    <button key={c} type="button" aria-pressed={form.cadence === c} onClick={() => { setForm(f => ({ ...f, cadence: c, periodDays: '' })); setCustomEnd(''); setError('') }}>
                      {c === 'daily' ? 'Daily' : c === 'weekly' ? 'Weekly' : c === 'monthly' ? 'Monthly' : 'Flexible'}
                    </button>
                  ))}
                </div>

                {isFlex ? (
                  <div className="ui-field">
                    <label className="ui-label" htmlFor="flex-end">Ends on</label>
                    <DatePicker id="flex-end" ariaLabel="Plan end date" sheetTitle="Pick an end date" allowEmpty placeholder="Choose a date"
                      minIso={isoDate(minEnd)} maxIso={isoDate(addDays(planStart, MAX_PLAN_DAYS))} emptyViewIso={isoDate(minEnd)}
                      value={form.endDate} onChange={iso => set('endDate', iso)} />
                    {flexEndError
                      ? <FieldError id="flex-end-error" message={flexEndError} />
                      : <p className="ag-fineprint">Any amount, any day, until this date. At least {terms.minTermMonths} months.</p>}
                  </div>
                ) : (
                <div className="ag-grid-2">
                  <Field id="amt" label={`Amount ${UNIT[form.cadence]}`}>
                    <span className="ag-tf-money">
                      <span aria-hidden="true">₦</span>
                      <input id="amt" className="ag-tf-input ag-tf-num" type="tel" inputMode="decimal" onKeyDown={blockMinus}
                        placeholder={form.cadence === 'weekly' ? '3,500' : form.cadence === 'monthly' ? '15,000' : '500'}
                        value={form.dailyAmount} onChange={e => set('dailyAmount', nonNegativeString(e.target.value))} />
                    </span>
                  </Field>
                  <Field id="per" label="For how long">
                    <select id="per" className="ag-tf-input ag-tf-select" value={customEnd ? 'custom' : form.periodDays} onChange={e => {
                      if (e.target.value === 'custom') {
                        const end = isoDate(addDays(planStart, parseInt(form.periodDays || PERIODS[fixed][1][0])))
                        setCustomEnd(end)
                        set('periodDays', String(endDateDays(end, planStart, fixed) ?? ''))
                      } else { setCustomEnd(''); set('periodDays', e.target.value) }
                    }}>
                      <option value="">Choose</option>
                      {PERIODS[fixed].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      <option value="custom">Choose an end date…</option>
                    </select>
                  </Field>
                </div>
                )}
                <div className="ag-grid-2">
                  <div className="ui-field">
                    <label className="ui-label" htmlFor="sd">Start date</label>
                    <DatePicker id="sd" ariaLabel="Plan start date" sheetTitle="Pick a start date" todayPrefix
                      value={form.startDate || isoDate(today())} onChange={iso => {
                        const v = iso === isoDate(today()) ? '' : iso
                        set('startDate', v)
                        // Keep a chosen end date where it is; the length changes instead.
                        if (customEnd) set('periodDays', String(endDateDays(customEnd, parseDateInput(v) ?? today(), fixed) ?? ''))
                      }} />
                    <p className="ag-fineprint">Starts today unless you pick another day.</p>
                  </div>
                  <Field id="nt" label="Note (optional)">
                    <input id="nt" className="ag-tf-input" placeholder="e.g. Daughter’s school fees" value={form.notes} onChange={e => set('notes', e.target.value)} />
                  </Field>
                </div>

                {customEnd && !isFlex && (
                  <EndDateField picker start={planStart} cadence={fixed} value={customEnd}
                    onChange={(v, days) => { setCustomEnd(v); set('periodDays', days ? String(days) : '') }} />
                )}

                {draftValid && isFlex && flexEnd && (
                  <div className="ag-target">
                    <span className="ui-row-sub ui-block">Saving until</span>
                    <span className="ag-target-amount">{maturity(form)}</span>
                    <span className="ui-row-sub ui-block">{feeSentence({ live: true, cadence: 'flexible', amountPerPayment: 0, periodicFeePct: 0, flexible: { cashCommissionPct: terms.cashCommissionPct, penaltyPct: terms.penaltyPct, online: false } })}</span>
                  </div>
                )}
                {draftValid && !isFlex && (
                  <div className="ag-target">
                    <span className="ui-row-sub ui-block">They’ll have saved</span>
                    <span className="ag-target-amount">{formatNaira(planTarget(form), { minor: false })}</span>
                    <span className="ui-row-sub ui-block">by {maturity(form)}</span>
                  </div>
                )}

                <button type="button" className="ui-btn ui-btn--plain ag-add-plan" disabled={!draftValid} onClick={() => { addDraftPlan(); setError('') }}>
                  <Icons.add size={18} aria-hidden="true" /> Save this plan and add another
                </button>

                <FlowActions primary={<button type="button" className="ui-btn ui-btn--primary ag-flow-cta" onClick={() => {
                  if (draftHasAny && !draftValid) { setError(isFlex ? 'Finish this plan (goal and end date), or clear it to continue.' : 'Finish this plan (goal, amount and length), or clear it to continue.'); return }
                  if (!draftValid && form.plans.length === 0) { setError('Add at least one savings plan.'); return }
                  if (draftValid) addDraftPlan()
                  go(4)
                }}>Continue</button>} />
              </>
            )}

            {/* 4 — Card and fee */}
            {step === 4 && (
              <>
                <h3 className="ag-sub">Savings card <span>Optional</span></h3>
                <div className="ag-card-row">
                  <Field id="card" label="Card serial">
                    <input id="card" className="ag-tf-input" placeholder="VES-NFC-00841" value={form.nfcCard} onChange={e => set('nfcCard', e.target.value)} />
                  </Field>
                  <button type="button" className="ui-btn ui-btn--secondary ag-scan-btn" onClick={startQrScan}><Icons.image size={18} aria-hidden="true" /> Scan</button>
                </div>
                {qrError && <p className="ui-field-error" role="alert"><Icons.error size={16} aria-hidden="true" /> {qrError}</p>}
                <p className="ag-fineprint">{form.nfcCard ? 'Standard NFC card. It links to the account when activated.' : 'Scan the QR on the card or type its serial. You can also link one later.'}</p>

                <h3 className="ag-sub">Registration fee</h3>
                <div className="ag-fee">
                  <span>One-off fee</span>
                  <strong>{formatNaira(REGISTRATION_FEE, { minor: false })}</strong>
                </div>
                <p className="ag-fineprint">Taken from your wallet when the request is approved. Your balance is {formatNaira(walletBalance)}.</p>

                {qrScanActive && (
                  <div className="ag-qr" role="dialog" aria-modal="true" aria-label="Scan card QR code">
                    <p className="ag-qr-title">Point the camera at the card’s QR code</p>
                    <div className="ag-qr-frame">
                      <video ref={qrVideoRef} playsInline muted />
                      <span className="ag-qr-target" aria-hidden="true" />
                    </div>
                    <p className="ag-qr-hint">{qrStreamReady ? 'Scanning…' : 'Opening camera…'}</p>
                    <button type="button" className="ui-btn ui-btn--secondary ag-qr-cancel" onClick={stopQrScan}>Cancel</button>
                  </div>
                )}

                <FlowActions primary={<button type="button" className="ui-btn ui-btn--primary ag-flow-cta" onClick={() => go(5)}>
                  {form.nfcCard ? 'Continue' : 'Continue without a card'}
                </button>} />
              </>
            )}

            {/* 5 — Review */}
            {step === 5 && (
              <>
                <div className="ag-rv-person">
                  {photoDataUrl ? <img src={photoDataUrl} alt="" /> : <span className="ui-avatar" aria-hidden="true">{form.firstName[0]}{form.lastName[0]}</span>}
                  <div>
                    <p className="ag-rv-name">{fullName}</p>
                    <p className="ui-row-sub ag-rv-phone">{form.phone}</p>
                  </div>
                </div>

                <ReviewSection title="Personal details" onEdit={() => go(1)}>
                  <Row k="Gender" v={form.gender} />
                  <Row k="Address" v={`${form.address}, ${form.lga}, ${form.state}`} />
                  <Row k="Language" v={form.language} />
                  {form.nokName && <Row k="Next of kin" v={`${form.nokName} (${form.nokRelation})`} />}
                </ReviewSection>

                <ReviewSection title={form.plans.length > 1 ? `Savings plans (${form.plans.length})` : 'Savings plan'} onEdit={() => go(3)}>
                  {form.plans.map((p, i) => (
                    <div key={i} className="ag-rv-plan">
                      <div>
                        <span className="ui-row-title ui-block">{p.goal}</span>
                        <span className="ui-row-sub ui-block">{p.cadence === 'flexible' ? `Flexible · any amount, any day · ends ${maturity(p)}` : `${formatNaira(parseFloat(p.dailyAmount || '0'), { minor: false })} ${UNIT[p.cadence]} · ${periodLabel(p)} · ends ${maturity(p)}`}</span>
                      </div>
                      {p.cadence !== 'flexible' && <span className="ag-rv-target">{formatNaira(planTarget(p), { minor: false })}</span>}
                    </div>
                  ))}
                </ReviewSection>

                <ReviewSection title="Card and fee" onEdit={() => go(4)}>
                  <Row k="Card" v={form.nfcCard || 'Link later'} />
                  <Row k="Registration fee" v={`${formatNaira(REGISTRATION_FEE, { minor: false })}, from your wallet when approved`} />
                </ReviewSection>

                <button type="button" role="checkbox" aria-checked={form.agreed} className={`ag-agree${form.agreed ? ' is-on' : ''}`} onClick={() => { set('agreed', !form.agreed); setError('') }}>
                  <span className="ag-agree-box" aria-hidden="true">{form.agreed && <Icons.check size={16} />}</span>
                  <span>The customer agrees to the terms. They understand how much they save, for how long, when the plan ends, the withdrawal rules. {reviewFees}</span>
                </button>

                <FlowActions primary={<button type="button" className="ui-btn ui-btn--primary ag-flow-cta" disabled={loading || !form.agreed} onClick={submit}>
                  {loading ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Sending…</> : 'Submit for approval'}
                </button>} />
              </>
            )}
          </div>
        </div>

        <aside className="ag-flow-steps" aria-label="Enrolment steps">
          <div className="ag-rv-person ag-steps-person">
            {photoDataUrl
              ? <img src={photoDataUrl} alt="" />
              : <span className="ui-avatar" aria-hidden="true">{form.firstName || form.lastName ? `${form.firstName[0] ?? ''}${form.lastName[0] ?? ''}` : <Icons.customers size={22} />}</span>}
            <div className="ag-payee-main">
              <p className="ui-row-sub">Enrolling</p>
              <p className="ui-row-title">{fullName || 'New customer'}</p>
            </div>
          </div>
          <ol className="ag-steplist">
            {STEPS.map((s, i) => {
              const n = i + 1
              const state = n < step ? 'done' : n === step ? 'current' : 'todo'
              return (
                <li key={s} className={`is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                  <span className="ag-steplist-dot" aria-hidden="true">{state === 'done' ? <Icons.check size={14} /> : n}</span>
                  <span className="ag-steplist-text">
                    <span className="ag-steplist-title">{s}</span>
                    {state === 'current' && <span className="ag-steplist-hint">{question[n]}</span>}
                  </span>
                </li>
              )
            })}
          </ol>
        </aside>
      </div>
    </div>
  )
}

/** Text field with its label inside the border (Cleo / Booking style); the input is a bare child. */
function Field({ id, label, required, hint, error, children }: { id: string; label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="ag-tf-wrap">
      <div className={`ag-tf${error ? ' is-invalid' : ''}`}>
        <label className="ag-tf-label" htmlFor={id}>{label}{required && <span className="ag-req" aria-hidden="true"> *</span>}</label>
        {children}
      </div>
      {error ? <FieldError id={`${id}-error`} message={error} /> : hint ? <p className="ag-fineprint">{hint}</p> : null}
    </div>
  )
}

/** The step's one main button, pinned to the bottom of the screen. */
function FlowActions({ primary }: { primary: ReactNode }) {
  return <div className="ag-flow-actions">{primary}</div>
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section className="ag-rv">
      <div className="ag-rv-head">
        <h3>{title}</h3>
        <button type="button" className="ui-link" onClick={onEdit}>Edit</button>
      </div>
      {children}
    </section>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="ag-rv-row"><span>{k}</span><span>{v}</span></div>
}
