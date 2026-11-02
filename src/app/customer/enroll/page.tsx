'use client'
import { useState, useRef, useEffect, Suspense, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { blockNonDigit, digitsOnly } from '@/lib/numeric'
import Logo from '@/components/Logo'
import AmountField from '@/components/ui/AmountField'
import EndDateField, { endDateDays } from '@/components/ui/EndDateField'
import BottomSheet from '@/components/ui/BottomSheet'
import CodeBoxes from '@/components/ui/CodeBoxes'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { Icons, type IconName } from '@/components/ui/icons'
import { formatDate, formatNaira } from '@/lib/format'
import { NG_STATES, lgasOf } from '@/lib/ng-lgas'
import { addDays, isoDate, parseDateInput, today } from '@/lib/plan-dates'

type Cadence = 'daily' | 'weekly' | 'monthly'
/** `start` is a chosen start date ("yyyy-mm-dd"); missing or empty means the plan starts today. */
type PlanDraft = { daily: number; period: number; goal: string; cadence: Cadence; start?: string }

const DURATIONS = [31, 62, 93, 186, 365] // in days; shown as weeks / months for those cadences
/** What people save for. `value` is what the API stores; `label` is how we say it to them. */
const GOAL_META = [
  { value: 'School Fees', label: 'School fees', icon: 'goalSchool' },
  { value: 'Business Capital', label: 'My business', icon: 'goalBusiness' },
  { value: 'House Rent / Building', label: 'Rent or a house', icon: 'goalRent' },
  { value: 'Medical Expenses', label: 'Health', icon: 'goalHealth' },
  { value: 'Wedding / Event', label: 'A wedding or event', icon: 'goalEvent' },
  { value: 'Farm / Agriculture', label: 'My farm', icon: 'goalFarm' },
  { value: 'General Savings', label: 'Just saving', icon: 'plan' },
] as const satisfies readonly { value: string; label: string; icon: IconName }[]
const goalMeta = (v: string) => GOAL_META.find(g => g.value === v) ?? GOAL_META[GOAL_META.length - 1]
const RELATIONS = ['Spouse', 'Parent', 'Sibling', 'Child', 'Friend']
const PRESETS: Record<Cadence, number[]> = { daily: [200, 500, 1000, 2000], weekly: [2000, 5000, 10000, 20000], monthly: [10000, 20000, 50000, 100000] }
const UNIT: Record<Cadence, { per: string; every: string; plural: string; days: number }> = {
  daily: { per: 'a day', every: 'every day', plural: 'days', days: 1 },
  weekly: { per: 'a week', every: 'every week', plural: 'weeks', days: 7 },
  monthly: { per: 'a month', every: 'every month', plural: 'months', days: 30 },
}

/** The plan stores a daily equivalent and a period counted in the cadence's own unit (days, weeks or months). */
const perPayment = (p: PlanDraft) => p.daily * UNIT[p.cadence].days
const totalSaved = (p: PlanDraft) => p.daily * p.period * UNIT[p.cadence].days
const startOf = (p: PlanDraft) => parseDateInput(p.start ?? '') ?? today()
const endDate = (p: PlanDraft) => addDays(startOf(p), p.period * UNIT[p.cadence].days)
const money2 = (n: number) => Math.round(n * 100) / 100

/** One question per screen, grouped into four sections; the hub screens show where you are between sections. */
const SCREENS = ['intro', 'name', 'contact', 'home', 'bvn', 'nok', 'password', 'hub-photo', 'photo', 'hub-plan', 'amount', 'length', 'goal', 'review'] as const
type Screen = typeof SCREENS[number]
const SECTIONS: { title: string; text: string; screens: Screen[] }[] = [
  { title: 'Your details', text: 'Your name, phone, email, address, someone to contact in an emergency, and a password.', screens: ['name', 'contact', 'home', 'bvn', 'nok', 'password'] },
  { title: 'Your photo', text: 'A clear photo of your face, so your agent can recognise you.', screens: ['photo'] },
  { title: 'Savings plan', text: 'How much you’ll save, how often, and for how long.', screens: ['amount', 'length', 'goal'] },
  { title: 'Review', text: 'Check everything, then open your account.', screens: ['review'] },
]
const HUB_SECTION: Partial<Record<Screen, number>> = { intro: 0, 'hub-photo': 1, 'hub-plan': 2 }
const sectionOf = (s: Screen) => SECTIONS.findIndex(sec => sec.screens.includes(s))

function EnrollContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const ref = searchParams.get('ref') ?? ''
  const aid = searchParams.get('aid') ?? ''
  const planParam = searchParams.get('plan')

  const parsedPlan = planParam?.match(/(\d+)x(\d+)d/)
  const initDaily = parsedPlan ? parseInt(parsedPlan[1]) : 500
  const initPeriod = parsedPlan ? parseInt(parsedPlan[2]) : 62

  const [screen, setScreen] = useState<Screen>('intro')
  const [returnToReview, setReturnToReview] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showMissing, setShowMissing] = useState(false)

  // Your details
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState('')
  const [address, setAddress] = useState('')
  const [state, setState] = useState('')
  const [lga, setLga] = useState('')
  const [bvn, setBvn] = useState('')
  const [bvnResult, setBvnResult] = useState<null | { key: string; ok: boolean; match?: boolean; error?: string }>(null)
  const [bvnChecking, setBvnChecking] = useState(false)
  const [nokName, setNokName] = useState('')
  const [nokRelation, setNokRelation] = useState('Spouse')
  const [nokPhone, setNokPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPass, setShowPass] = useState(false)

  // Photo
  const [photo, setPhoto] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const streamRef = useRef<MediaStream | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)

  // Savings plan: the one being filled in, and the ones already finished.
  const [daily, setDaily] = useState(initDaily)
  const [period, setPeriod] = useState(initPeriod)
  const [goal, setGoal] = useState('General Savings')
  /** The goal they tapped on the welcome screen; their first plan is named after it. */
  const [startGoal, setStartGoal] = useState('')
  const [cadence, setCadence] = useState<Cadence>('daily')
  const [plans, setPlans] = useState<PlanDraft[]>([])
  /** A chosen end date ("yyyy-mm-dd") instead of one of the set lengths; "" when a set length is picked. */
  const [customEnd, setCustomEnd] = useState('')
  /** The plan's start date ("yyyy-mm-dd"); "" means today. */
  const [planStart, setPlanStart] = useState('')
  /** Which saved plan the form is editing; -1 adds a new one. */
  const [editing, setEditing] = useState(-1)

  // Email code
  const [otpScreen, setOtpScreen] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)

  const [terms, setTerms] = useState(false)

  // Phone already registered? Checked with the server when the phone field is left (the server still guards it).
  const [phoneTaken, setPhoneTaken] = useState<string | null>(null)
  const [phoneChecking, setPhoneChecking] = useState(false)
  /** Seconds until a new email code can be requested (the server allows one a minute). */
  const [resendIn, setResendIn] = useState(0)
  /** The agent who sent the invite, shown on the welcome screen. */
  const [invite, setInvite] = useState<{ firstName: string; area: string | null; photo: string | null } | null>(null)
  const [result, setResult] = useState<{ customerId: string; name: string; agentName: string; plan: unknown } | null>(null)

  // The server only answers whether this name matches this BVN. Each check is a paid lookup from a small
  // budget, so it runs on the BVN screen, not per keystroke elsewhere, and only when something changed.
  const bvnKey = `${bvn}|${firstName}|${lastName}|${email}`
  useEffect(() => {
    if (screen !== 'bvn' || bvnResult?.key === bvnKey) return
    setBvnResult(null)
    // The contact screen has already confirmed the email the server asks for.
    if (bvn.length !== 11 || !emailVerified) return
    const ctrl = new AbortController()
    setBvnChecking(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/identity/bvn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bvn, email, firstName, lastName }),
          signal: ctrl.signal,
        })
        const d = await r.json()
        setBvnResult(d.ok ? { key: bvnKey, ok: true, match: !!d.match } : { key: bvnKey, ok: false, error: d.error ?? 'We couldn’t check this BVN.' })
        setBvnChecking(false)
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return
        setBvnResult({ key: bvnKey, ok: false, error: 'No connection. We couldn’t check your BVN.' })
        setBvnChecking(false)
      }
    }, 500)
    return () => { ctrl.abort(); clearTimeout(t); setBvnChecking(false) }
  }, [screen, bvnKey, emailVerified])

  useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()) }, [])

  useEffect(() => {
    if (!aid && !ref) return
    const q = new URLSearchParams()
    if (ref) q.set('ref', ref)
    if (aid) q.set('aid', aid)
    fetch(`/api/customer/enroll/invite?${q}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.firstName) setInvite({ firstName: d.firstName, area: d.area ?? null, photo: d.photo ?? null }) })
      .catch(() => {}) // The welcome screen works without it.
  }, [aid, ref])

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn(n => n - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  /** Asks the server whether this phone already has an account. Returns false only when it's known to be taken. */
  async function checkPhone(p: string): Promise<boolean> {
    if (phoneError(p, 'your')) return true
    if (phoneTaken === p) return false
    setPhoneChecking(true)
    try {
      const r = await fetch('/api/customer/phone-available', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p }),
      })
      if (!r.ok) return true // Rate-limited or down: don't block here; the server checks again at the end.
      const d = await r.json()
      if (d.available === false) { setPhoneTaken(p); return false }
      return true
    } catch { return true }
    finally { setPhoneChecking(false) }
  }

  // ── Draft: a refresh, a closed app or a dropped connection shouldn't lose what was typed ──
  // Kept on this device for a day. The password, BVN and photo are never stored.
  const [resume, setResume] = useState<Draft | null>(null)
  const draftReady = useRef(false)

  useEffect(() => {
    const d = readDraft()
    if (d && d.aid === aid && d.ref === ref) setResume(d)
    else if (d) clearDraft()
    draftReady.current = true
  }, [aid, ref])

  useEffect(() => {
    if (!draftReady.current || result || screen === 'intro') return
    const t = setTimeout(() => writeDraft({
      v: 1, savedAt: Date.now(), aid, ref, screen,
      firstName, lastName, phone, email, verifiedEmail: emailVerified ? email : '', dob, gender, address, state, lga,
      nokName, nokRelation, nokPhone, plans, plan: { daily, period, goal, cadence, start: planStart }, startGoal,
    }), 400)
    return () => clearTimeout(t)
  }, [aid, ref, screen, firstName, lastName, phone, email, emailVerified, dob, gender, address, state, lga, nokName, nokRelation, nokPhone, plans, daily, period, goal, cadence, startGoal, result])

  function continueDraft(d: Draft) {
    setFirstName(d.firstName); setLastName(d.lastName); setPhone(d.phone); setEmail(d.email)
    setEmailVerified(!!d.verifiedEmail && d.verifiedEmail === d.email)
    setDob(d.dob); setGender(d.gender === 'Female' || d.gender === 'Male' ? d.gender : ''); setAddress(d.address); setState(d.state ?? ''); setLga(d.lga ?? '')
    setNokName(d.nokName); setNokRelation(d.nokRelation); setNokPhone(d.nokPhone)
    setPlans(d.plans); loadPlan(d.plan); setStartGoal(d.startGoal ?? '')
    setResume(null)
    // The password and photo weren't kept, so pick up at the first of those still needed.
    const at = SCREENS.indexOf(d.screen)
    go(at > SCREENS.indexOf('password') ? 'password' : d.screen)
  }

  function startAgain() {
    clearDraft()
    setResume(null)
  }

  const draft: PlanDraft = { daily, period, goal, cadence, start: planStart || undefined }
  const startDay = startOf(draft)
  const endDateInvalid = !!customEnd && endDateDays(customEnd, startDay, cadence) === null

  function go(next: Screen) {
    setError('')
    setShowMissing(false)
    setScreen(next)
    window.scrollTo({ top: 0 })
  }

  /** Forward from a details or photo screen: back to Review when that's where the edit started. */
  function advance() {
    if (returnToReview) { setReturnToReview(false); go('review'); return }
    go(SCREENS[SCREENS.indexOf(screen) + 1])
  }

  function back() {
    if (screen === 'photo') stopCamera()
    if (returnToReview) { setReturnToReview(false); go('review'); return }
    if (screen === 'amount' && plans.length > 0) { setEditing(-1); go('review'); return }
    if (screen === 'review') { editPlan(plans.length - 1, 'goal'); return }
    go(SCREENS[SCREENS.indexOf(screen) - 1])
  }

  function editFromReview(s: Screen) {
    setReturnToReview(true)
    go(s)
  }

  function loadPlan(p: PlanDraft) {
    setDaily(p.daily); setPeriod(p.period); setGoal(p.goal); setCadence(p.cadence); setPlanStart(p.start ?? '')
    // A length that isn't one of the set options was a chosen end date; show it as one.
    const preset = DURATIONS.some(d => Math.round(d / UNIT[p.cadence].days) === p.period)
    setCustomEnd(preset ? '' : isoDate(endDate(p)))
  }

  function editPlan(i: number, at: Screen = 'amount') {
    const p = plans[i]
    if (!p) { go('goal'); return }
    loadPlan(p)
    setEditing(i)
    go(at)
  }

  function addPlan() {
    loadPlan(plans.length === 0
      ? { daily: initDaily, period: initPeriod, goal: startGoal || 'General Savings', cadence: 'daily' }
      : { daily: 500, period: 62, goal: 'General Savings', cadence: 'daily' })
    setEditing(-1)
    go('amount')
  }

  /** Saves the plan in the form, replacing the one being edited so it is never added twice. */
  function savePlan() {
    setPlans(ps => editing >= 0 && editing < ps.length ? ps.map((p, i) => i === editing ? draft : p) : [...ps, draft])
    setEditing(-1)
    go('review')
  }

  // Inline validation: each field is checked once you leave it, then re-checked as you type.
  // The rules match what /api/customer/enroll requires, so nothing fails at the last step.
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const touch = (k: string) => () => setTouched(t => (t[k] ? t : { ...t, [k]: true }))
  const phoneError = (v: string, who: 'your' | 'their') =>
    !v ? `Enter ${who} phone number`
      : v.length < 11 ? `Phone numbers have 11 digits. This has ${v.length}.`
      : !v.startsWith('0') ? 'Start with 0, like 0803 123 4567'
      : ''
  // A result for an older name or BVN says nothing about what's typed now; the server checks again at the end.
  const bvnMismatch = bvnResult?.key === bvnKey && !!bvnResult.ok && !bvnResult.match
  const rules: Record<string, string> = {
    fn: firstName.trim() ? '' : 'Enter your first name',
    ln: lastName.trim() ? '' : 'Enter your last name',
    ph: phoneError(phone, 'your') || (phoneTaken === phone ? 'This number already has an account.' : ''),
    em: !email.trim() ? 'Enter your email address' : /^\S+@\S+\.\S+$/.test(email.trim()) ? '' : 'Check your email. It should look like name@example.com',
    addr: !address.trim() ? 'Enter your home address' : address.trim().length < 8 ? 'Add more detail, like the street and area' : '',
    st: state ? '' : 'Choose your state',
    lga: !state ? 'Choose your state first' : lga ? '' : 'Choose your local government',
    dob: dob && new Date(dob) > new Date() ? 'Your date of birth can’t be in the future' : '',
    gd: gender ? '' : 'Choose your gender',
    bvn: bvn && bvn.length < 11 ? `A BVN has 11 digits. This has ${bvn.length}.` : bvnMismatch ? 'This BVN doesn’t match your name' : '',
    nok: nokName.trim() ? '' : 'Enter their name',
    nokp: phoneError(nokPhone, 'their') || (nokPhone === phone ? 'Use a different number from your own' : ''),
    pw: password.length >= 6 ? '' : password ? `Use at least 6 characters. This has ${password.length}.` : 'Create a password',
    pw2: !confirmPassword ? 'Type your password again' : confirmPassword !== password ? 'The two passwords don’t match' : '',
  }
  /** The error to show for a field: only after it's been left, or after Continue was pressed. */
  const err = (k: string) => (showMissing || touched[k] ? rules[k] : '')
  /** Show a tick once a filled field has been left and passes. */
  const ok = (k: string) => !!touched[k] && !rules[k]
  /** Props that wire an input to its rule: checked on blur, error read out by screen readers. */
  const v = (k: string) => ({
    onBlur: touch(k),
    'aria-invalid': err(k) ? true : undefined,
    'aria-describedby': err(k) ? `${k}-error` : undefined,
  })
  const FIELDS: Partial<Record<Screen, string[]>> = {
    name: ['fn', 'ln'], contact: ['ph', 'em'], home: ['addr', 'st', 'lga', 'dob', 'gd'], bvn: ['bvn'], nok: ['nok', 'nokp'], password: ['pw', 'pw2'],
  }

  /** Checks the current screen; shows every problem on it instead of moving on. */
  function screenOk() {
    const ok = (FIELDS[screen] ?? []).every(k => !rules[k]) && !(screen === 'bvn' && bvn.length === 11 && bvnChecking)
    if (!ok) setShowMissing(true)
    return ok
  }

  async function sendEmailCode() {
    setOtpLoading(true); setError('')
    try {
      const res = await fetch('/api/customer/email-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok) { setOtpCode(''); setOtpError(''); setOtpScreen(true); setResendIn(60) }
      else {
        const d = await res.json().catch(() => ({}))
        // 429: a code was sent in the last minute. If they already have one, let them enter it.
        if (res.status === 429 && resendIn > 0) { setOtpScreen(true); return }
        setError(d.error ?? 'We couldn’t send the code. Check your email address.')
      }
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally { setOtpLoading(false) }
  }

  async function verifyEmailCode() {
    setOtpLoading(true); setOtpError('')
    try {
      const res = await fetch('/api/customer/email-otp/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: otpCode }),
      })
      const d = await res.json()
      if (d.verified) {
        setEmailVerified(true)
        setOtpScreen(false)
        setOtpCode('')
        advance()
      } else {
        setOtpError(d.error ?? 'That code didn’t work. Check it and try again.')
      }
    } catch {
      setOtpError('No connection. Check your internet and try again.')
    } finally { setOtpLoading(false) }
  }

  async function resendEmailCode() {
    setOtpLoading(true); setOtpError('')
    try {
      const res = await fetch('/api/customer/email-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      if (res.ok) { setOtpCode(''); setResendIn(60) }
      else { const d = await res.json().catch(() => ({})); setOtpError(d.error ?? 'We couldn’t send a new code. Please try again.') }
    } catch { setOtpError('No connection. Check your internet and try again.') }
    finally { setOtpLoading(false) }
  }

  async function startCamera() {
    setCameraError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false })
      streamRef.current = stream
      setCameraOn(true)
      // The video element renders after the state update, so attach the stream once the DOM has settled.
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      }, 100)
    } catch (e) {
      // Only a photo taken now is accepted, so explain how to let the camera in rather than offering an upload.
      const denied = (e as { name?: string })?.name === 'NotAllowedError'
      setCameraError(denied
        ? 'Camera access is blocked. Allow the camera for this site in your browser or phone settings, then try again.'
        : 'We couldn’t open your camera. Close other apps using it, then try again.')
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCameraOn(false)
    setCountdown(null)
  }

  function shootCountdown() {
    let c = 3
    setCountdown(c)
    const iv = setInterval(() => {
      c--
      if (c > 0) { setCountdown(c) }
      else {
        clearInterval(iv)
        setCountdown(null)
        capturePhoto()
      }
    }, 1000)
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth || 720
    canvas.height = video.videoHeight || 960
    const ctx = canvas.getContext('2d')!
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    setPhoto(canvas.toDataURL('image/jpeg', 0.88))
    stopCamera()
  }

  function setCadenceKeepingLength(next: Cadence) {
    // Convert the chosen length into the new unit.
    const days = period * UNIT[cadence].days
    setPeriod(Math.max(1, Math.round(days / UNIT[next].days)))
    setCadence(next)
    setCustomEnd('')
  }

  async function createAccount() {
    if (!terms) { setError('Tick the box to agree to the terms.'); return }
    if (plans.length === 0) { addPlan(); return }
    setLoading(true); setError('')
    try {
      const first = plans[0]
      const res = await fetch('/api/customer/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref, aid, firstName, lastName, phone, email, dob, address, state, lga, gender, bvn,
          nokName, nokRelation, nokPhone, photoUrl: photo, password,
          // This API takes the amount per payment and divides weekly / monthly amounts itself. It reads the first
          // plan's length as days but the other plans' lengths in weeks or months, so send each the way it reads it.
          dailyAmount: money2(perPayment(first)), periodDays: first.period * UNIT[first.cadence].days, goal: first.goal, cadence: first.cadence,
          startDate: first.start || undefined,
          plans: plans.map(p => ({ daily: money2(perPayment(p)), period: p.period, goal: p.goal, cadence: p.cadence, startDate: p.start || undefined })),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Your account couldn’t be created. Please try again.'); return }
      clearDraft()
      setResult(data)
      window.scrollTo({ top: 0 })
    } catch { setError('No connection. Check your internet and try again.') }
    finally { setLoading(false) }
  }

  // ── Done ──
  if (result) {
    const p = plans[0]
    return (
      <div className="ui-screen cu-enroll">
        <main className="cu-page cu-done">
          <div className="cu-done-mark">
            {photo
              ? <><img src={photo} alt="" /><span className="cu-done-tick" aria-hidden="true"><Icons.check size={20} strokeWidth={3} /></span></>
              : <span className="cu-done-blank" aria-hidden="true"><Icons.check size={48} strokeWidth={2.5} /></span>}
          </div>
          <h1 className="cu-q cu-center">You’re all set, {result.name.split(' ')[0]}</h1>
          <p className="cu-lead cu-center">Your savings account is open.</p>
          <dl className="cu-receipt">
            <div><dt>Customer ID</dt><dd className="ag-mono">{result.customerId}</dd></div>
            <div><dt>Your agent</dt><dd>{result.agentName}</dd></div>
            {p && <div><dt>{goalMeta(p.goal).label}</dt><dd>{formatNaira(perPayment(p), { minor: false })} {UNIT[p.cadence].per}</dd></div>}
            {p && <div><dt>Plan ends</dt><dd>{formatDate(endDate(p))}</dd></div>}
          </dl>
          <p className="cu-note cu-center">Keep your customer ID. Your agent may ask for it.</p>
          <div className="cu-actions">
            <button type="button" className="ui-btn ui-btn--primary cu-cta" onClick={() => router.push('/customer/save')}>Make your first saving</button>
            <button type="button" className="ui-btn ui-btn--plain cu-cta-2" onClick={() => router.push('/customer/dashboard')}>Go to my account</button>
          </div>
        </main>
      </div>
    )
  }

  const cta0 = (label: ReactNode, onClick: () => void) => (
    <button type="button" className="ui-btn ui-btn--primary cu-cta" onClick={onClick}>{label}</button>
  )

  // ── Welcome: their reason for saving comes first ──
  if (screen === 'intro') {
    return (
      <div className="ui-screen cu-enroll">
        <header className="cu-hello">
          <div className="cu-hello-in">
            <div className="cu-brandbar">
              <span className="cu-brand"><Logo size={34} variant="mono" /><span>Vochus Easy Save</span></span>
              <a className="cu-signin" href="/customer/login">Sign in</a>
            </div>
            {invite && (
              <p className="cu-invite">
                {invite.photo
                  ? <img src={invite.photo} alt="" />
                  : <span className="cu-invite-initial" aria-hidden="true">{invite.firstName[0]}</span>}
                <span>Invited by <strong>{invite.firstName}</strong>, your agent{invite.area ? ` in ${invite.area}` : ''}</span>
              </p>
            )}
            <h1 className="cu-hello-title">{resume?.firstName ? `Welcome back, ${resume.firstName}` : 'Let’s save for what matters to you'}</h1>
            <p className="cu-hello-text">
              {resume
                ? `You started opening your account ${timeAgo(resume.savedAt)}. Your details are saved on this phone.`
                : 'Give your agent a little at a time. Every saving shows in your account, and you collect it when your plan ends.'}
            </p>
            {!resume && parsedPlan && (
              <p className="cu-hello-plan">Your agent suggested <strong>{formatNaira(initDaily, { minor: false })} a day</strong> for {initPeriod} days. That’s <strong>{formatNaira(initDaily * initPeriod, { minor: false })}</strong>.</p>
            )}
          </div>
        </header>

        <main className={`cu-page cu-page--welcome${resume ? ' is-resume' : ''}`}>
          {resume ? (
            <>
              {(() => {
                const m = goalMeta(resume.startGoal || resume.plan.goal)
                const Icon = Icons[m.icon]
                const at = SCREENS.indexOf(resume.screen)
                const pct = Math.round((at / (SCREENS.length - 1)) * 100)
                const saved = [
                  `${resume.firstName} ${resume.lastName}`.trim(),
                  resume.phone,
                  resume.email,
                  resume.address,
                ].filter(Boolean)
                return (
                  <section className="cu-progress-card" aria-label="Your progress">
                    <div className="cu-progress-card-head">
                      <span className="cu-goal-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.75} /></span>
                      <div>
                        <p className="cu-option-title">{m.value === 'General Savings' ? 'Your savings account' : `Your ${m.label.toLowerCase()} plan`}</p>
                        <p className="cu-option-sub">{pct}% done · {SECTIONS[sectionOf(resume.screen)]?.title ?? SECTIONS[0].title}</p>
                      </div>
                    </div>
                    <div className="ui-progress cu-progress-card-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="How much is done"><span style={{ width: `${pct}%` }} /></div>
                    {saved.length > 0 && (
                      <ul className="cu-saved" aria-label="Already saved">
                        {saved.map(v => <li key={v}><Icons.check size={14} strokeWidth={2.5} aria-hidden="true" /> {v}</li>)}
                      </ul>
                    )}
                  </section>
                )
              })()}
              {SCREENS.indexOf(resume.screen) > SCREENS.indexOf('password') && (
                <p className="cu-note">For your security, you’ll add your password{SCREENS.indexOf(resume.screen) > SCREENS.indexOf('photo') ? ' and photo' : ''} again.</p>
              )}
              <div className="cu-actions">
                {cta0('Continue where I left off', () => continueDraft(resume))}
                <button type="button" className="ui-btn ui-btn--plain cu-cta-2" onClick={startAgain}>Start again</button>
              </div>
            </>
          ) : (
            <>
              <h2 className="cu-pick-title" id="goal-pick">What are you saving for?</h2>
              <div className="cu-goals" role="group" aria-labelledby="goal-pick">
                {GOAL_META.map(g => {
                  const Icon = Icons[g.icon]
                  return (
                    <button key={g.value} type="button" className="cu-goal"
                      onClick={() => { setStartGoal(g.value); setGoal(g.value); go('name') }}>
                      <span className="cu-goal-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.75} /></span>
                      <span className="cu-goal-label">{g.label}</span>
                    </button>
                  )
                })}
              </div>
              <p className="cu-meta cu-hello-foot"><Icons.pending size={16} aria-hidden="true" /> About 5 minutes. If you stop, your details stay on this phone.</p>
            </>
          )}
        </main>
      </div>
    )
  }

  // ── Hubs: where you are, between sections ──
  const hub = HUB_SECTION[screen]
  if (hub !== undefined) {
    const g = goalMeta(startGoal || goal)
    return (
      <div className="ui-screen cu-enroll">
        <main className="cu-page">
          <div className="cu-brandbar">
            <button type="button" className="cu-back" aria-label="Back" onClick={back}><Icons.back size={22} aria-hidden="true" /></button>
          </div>
          <h1 className="cu-q">{hub === 1 ? `Nice to meet you, ${firstName.trim()}` : startGoal && startGoal !== 'General Savings' ? `Now, your ${g.label.toLowerCase()} plan` : 'Now, your savings plan'}</h1>
          <p className="cu-meta"><Icons.pending size={16} aria-hidden="true" /> {SECTIONS.length - hub} short parts left</p>
          {hub === 1 && (
            <div className="cu-hub-art" aria-hidden="true"><span className="cu-hub-oval"><FaceOutline /></span></div>
          )}
          {hub === 2 && (
            <div className="cu-preview">
              <span className="cu-preview-label">{parsedPlan ? 'Your agent suggested' : 'For example'}</span>
              <span className="cu-preview-amount">{formatNaira(initDaily, { minor: false })}<small> a day</small></span>
              <span className="cu-preview-row">
                <span>for {initPeriod} days</span>
                <strong>{formatNaira(initDaily * initPeriod, { minor: false })} saved</strong>
              </span>
            </div>
          )}
          <ol className="cu-steps">
            {SECTIONS.map((s, i) => (
              <li key={s.title} className={i < hub ? 'is-done' : i === hub ? 'is-now' : ''} aria-current={i === hub ? 'step' : undefined}>
                <span className="cu-steps-mark" aria-hidden="true">{i < hub ? <Icons.check size={14} strokeWidth={3} /> : i + 1}</span>
                <div className="cu-steps-body">
                  <span className="cu-steps-title">{s.title}{i < hub && <span className="ag-sr"> (done)</span>}</span>
                  {i === hub && <span className="cu-steps-text">{s.text}</span>}
                  {i === 0 && i < hub && <span className="cu-steps-recap">{`${firstName} ${lastName}`.trim()} · {phone}</span>}
                  {i === 1 && i < hub && photo && <img className="cu-steps-thumb" src={photo} alt="" />}
                </div>
              </li>
            ))}
          </ol>
          <div className="cu-actions">
            {cta0('Continue', () => { if (hub === 2) addPlan(); else go(SCREENS[SCREENS.indexOf(screen) + 1]) })}
          </div>
        </main>
      </div>
    )
  }

  // ── Question screens ──
  const sec = sectionOf(screen)
  const inSec = SECTIONS[sec].screens.indexOf(screen)
  const cta = (label: ReactNode, onClick: () => void, disabled = false) => (
    <button type="button" className="ui-btn ui-btn--primary cu-cta" disabled={disabled} onClick={onClick}>{label}</button>
  )
  const nextIfOk = () => { if (screenOk()) advance() }

  return (
    <div className="ui-screen cu-enroll">
      <main className="cu-page">
        <header className="cu-top">
          <button type="button" className="cu-back" aria-label="Back" onClick={back}><Icons.back size={22} aria-hidden="true" /></button>
          <div className="cu-progress" role="progressbar" aria-valuemin={1} aria-valuemax={SECTIONS.length} aria-valuenow={sec + 1} aria-label={`Part ${sec + 1} of ${SECTIONS.length}: ${SECTIONS[sec].title}`}>
            {SECTIONS.map((s, i) => (
              <span key={s.title}><span style={{ width: i < sec ? '100%' : i > sec ? '0%' : `${((inSec + 1) / s.screens.length) * 100}%` }} /></span>
            ))}
          </div>
        </header>

        <p className="cu-kicker">{SECTIONS[sec].title}</p>

        {screen === 'name' && (
          <>
            <h1 className="cu-q">What’s your name?</h1>
            <p className="cu-lead">Use the name on your bank account.</p>
            <FormError message={error} />
            <Field id="fn" label="First name" error={err('fn')} valid={ok('fn')}>
              <input id="fn" className="ag-tf-input" autoComplete="given-name" autoCapitalize="words" value={firstName} {...v('fn')} onChange={e => setFirstName(e.target.value)} />
            </Field>
            <Field id="ln" label="Last name" error={err('ln')} valid={ok('ln')}>
              <input id="ln" className="ag-tf-input" autoComplete="family-name" autoCapitalize="words" value={lastName} {...v('ln')} onChange={e => setLastName(e.target.value)} />
            </Field>
            <div className="cu-actions">{cta('Continue', nextIfOk)}</div>
          </>
        )}

        {screen === 'contact' && (
          <>
            <h1 className="cu-q">How can we reach you?</h1>
            <p className="cu-lead">We’ll send a code to your email to check it’s yours.</p>
            <FormError message={error} />
            <Field id="ph" label="Phone number" error={err('ph')} valid={ok('ph')}>
              <input id="ph" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" maxLength={11} placeholder="080 0000 0000" autoComplete="tel"
                value={phone} {...v('ph')} onBlur={() => { touch('ph')(); checkPhone(phone) }} onKeyDown={blockNonDigit} onChange={e => setPhone(digitsOnly(e.target.value).slice(0, 11))} />
            </Field>
            {phoneTaken === phone && <p className="cu-note cu-taken"><a className="ui-link" href="/customer/login">Sign in instead</a> or use a different number.</p>}
            <Field id="em" label="Email" error={err('em')} valid={ok('em')}
              badge={emailVerified ? <span className="cu-ok"><Icons.check size={14} strokeWidth={3} aria-hidden="true" /> Confirmed</span> : undefined}>
              <input id="em" className="ag-tf-input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@email.com"
                value={email} {...v('em')} onChange={e => { setEmail(e.target.value); setEmailVerified(false) }} />
            </Field>
            <div className="cu-actions">
              {cta(otpLoading || phoneChecking ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> {phoneChecking ? 'Checking…' : 'Sending code…'}</> : emailVerified ? 'Continue' : 'Send code', async () => {
                if (!screenOk()) return
                if (!(await checkPhone(phone))) { setShowMissing(true); return }
                if (emailVerified) advance(); else sendEmailCode()
              }, otpLoading || phoneChecking)}
            </div>
          </>
        )}

        {screen === 'home' && (
          <>
            <h1 className="cu-q">Where do you live?</h1>
            <p className="cu-lead">So your agent knows where to find you.</p>
            <FormError message={error} />
            <Field id="addr" label="Home address" error={err('addr')} valid={ok('addr')}>
              <input id="addr" className="ag-tf-input" placeholder="House number, street and area" autoComplete="street-address"
                value={address} {...v('addr')} onChange={e => setAddress(e.target.value)} />
            </Field>
            <div className="cu-grid-2">
              <Field id="st" label="State" error={err('st')} valid={ok('st')}>
                <select id="st" className="ag-tf-input ag-tf-select" value={state} {...v('st')}
                  onChange={e => { setState(e.target.value); setLga(''); setTouched(t => ({ ...t, st: true })) }}>
                  <option value="">Choose</option>
                  {NG_STATES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field id="lga" label="Local government" error={err('lga')} valid={ok('lga')}>
                <select id="lga" className="ag-tf-input ag-tf-select" value={lga} disabled={!state} {...v('lga')}
                  onChange={e => { setLga(e.target.value); setTouched(t => ({ ...t, lga: true })) }}>
                  <option value="">{state ? 'Choose' : 'Choose a state first'}</option>
                  {lgasOf(state).map(l => <option key={l}>{l}</option>)}
                </select>
              </Field>
            </div>
            <Field id="dob" label="Date of birth (optional)" error={err('dob')}>
              <input id="dob" className="ag-tf-input" type="date" value={dob} {...v('dob')} max={new Date().toISOString().slice(0, 10)} onChange={e => setDob(e.target.value)} />
            </Field>
            <p className="cu-label" id="gd-label">Gender</p>
            <Choices labelledBy="gd-label" options={['Female', 'Male']} value={gender} onChange={v => { setGender(v); setTouched(t => ({ ...t, gd: true })) }} />
            {err('gd') && <FieldError id="gd-error" message={err('gd')} />}
            <div className="cu-actions">{cta('Continue', nextIfOk)}</div>
          </>
        )}

        {screen === 'bvn' && (
          <>
            <h1 className="cu-q">Add your BVN</h1>
            <p className="cu-lead">Optional. We check it against your name to confirm who you are. Dial <strong>*565*0#</strong> to find it.</p>
            <FormError message={error} />
            <Field id="bvn" label="BVN" error={bvnMismatch ? '' : err('bvn')}
              badge={bvn.length === 11 && bvnChecking ? <span className="cu-checking"><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Checking</span> : undefined}>
              <input id="bvn" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" maxLength={11} placeholder="11 digits" autoComplete="off"
                value={bvn} {...v('bvn')} onKeyDown={blockNonDigit} onChange={e => setBvn(digitsOnly(e.target.value).slice(0, 11))} />
            </Field>
            {bvnResult?.key === bvnKey && bvnResult.ok && (!bvnMismatch
                ? <div className="ag-verified ag-verified--sm"><span className="ag-verified-icon" aria-hidden="true"><Icons.check size={18} /></span><div><p className="ui-row-title">BVN matches your name</p></div></div>
                : <div className={`ui-banner ${showMissing ? 'ui-banner--danger' : 'ui-banner--warn'}`} role="alert"><Icons.error size={18} aria-hidden="true" /><div>This BVN doesn’t match the name you entered. Your name needs to be the same as on your bank records. <button type="button" className="ag-banner-link" onClick={() => go('name')}>Change your name</button> or <button type="button" className="ag-banner-link" onClick={() => setBvn('')}>remove the BVN</button> to carry on without it.</div></div>)}
            {bvnResult?.key === bvnKey && !bvnResult.ok && <p className="ui-field-error"><Icons.error size={16} aria-hidden="true" /> {bvnResult.error}</p>}
            <div className="cu-actions">{cta(bvn ? 'Continue' : 'Skip for now', nextIfOk, bvn.length === 11 && bvnChecking)}</div>
          </>
        )}

        {screen === 'nok' && (
          <>
            <h1 className="cu-q">Who should we call in an emergency?</h1>
            <p className="cu-lead">Someone close to you, in case we can’t reach you.</p>
            <FormError message={error} />
            <Field id="nok" label="Their full name" error={err('nok')} valid={ok('nok')}>
              <input id="nok" className="ag-tf-input" autoCapitalize="words" value={nokName} {...v('nok')} onChange={e => setNokName(e.target.value)} />
            </Field>
            <Field id="nokp" label="Their phone number" error={err('nokp')} valid={ok('nokp')}>
              <input id="nokp" className="ag-tf-input ag-tf-num" type="tel" inputMode="numeric" maxLength={11} placeholder="080 0000 0000"
                value={nokPhone} {...v('nokp')} onKeyDown={blockNonDigit} onChange={e => setNokPhone(digitsOnly(e.target.value).slice(0, 11))} />
            </Field>
            <p className="cu-label" id="nokr-label">They are your</p>
            <Choices labelledBy="nokr-label" options={RELATIONS} value={nokRelation} onChange={setNokRelation} />
            <div className="cu-actions">{cta('Continue', nextIfOk)}</div>
          </>
        )}

        {screen === 'password' && (
          <>
            <h1 className="cu-q">Create a password</h1>
            <p className="cu-lead">You’ll use it with your phone number to sign in.</p>
            <FormError message={error} />
            <Field id="pw" label="Password" error={err('pw')}
              badge={<button type="button" className="cu-show" aria-pressed={showPass} onClick={() => setShowPass(s => !s)}>{showPass ? 'Hide' : 'Show'}</button>}>
              <input id="pw" className="ag-tf-input" type={showPass ? 'text' : 'password'} autoComplete="new-password"
                value={password} {...v('pw')} onChange={e => setPassword(e.target.value)} />
            </Field>
            <Field id="pw2" label="Type it again" error={err('pw2')}>
              <input id="pw2" className="ag-tf-input" type={showPass ? 'text' : 'password'} autoComplete="new-password"
                value={confirmPassword} {...v('pw2')} onChange={e => setConfirmPassword(e.target.value)} />
            </Field>
            <ul className="cu-rules" aria-label="Password rules">
              <li className={password.length >= 6 ? 'is-met' : ''}><Icons.check size={14} strokeWidth={3} aria-hidden="true" /> At least 6 characters</li>
              <li className={!!confirmPassword && confirmPassword === password ? 'is-met' : ''}><Icons.check size={14} strokeWidth={3} aria-hidden="true" /> Both passwords match</li>
            </ul>
            <div className="cu-actions">{cta('Continue', nextIfOk)}</div>
          </>
        )}

        {screen === 'photo' && (
          <>
            <h1 className="cu-q">{photo && !cameraOn ? 'Is your face clear?' : 'Take a photo of your face'}</h1>
            <p className="cu-lead">{photo && !cameraOn ? 'Your agent will see this photo on your account.' : 'Your agent uses it to recognise your account.'}</p>
            <FormError message={error} />
            <div className={`cu-cam${cameraOn ? ' is-live' : ''}`}>
              <div className={`cu-oval${photo && !cameraOn ? ' has-photo' : ''}`}>
                {cameraOn && <video ref={videoRef} autoPlay playsInline muted style={{ transform: 'scaleX(-1)' }} />}
                {photo && !cameraOn && <img src={photo} alt="Your photo" />}
                {!cameraOn && !photo && <FaceOutline />}
                {countdown !== null && <span className="cu-countdown" aria-live="assertive">{countdown}</span>}
              </div>
              {cameraOn && <p className="cu-cam-hint">{countdown !== null ? 'Hold still' : 'Fit your face inside the oval'}</p>}
              {cameraOn && (
                <div className="cu-cam-bar">
                  <button type="button" className="cu-cam-cancel" onClick={stopCamera}>Cancel</button>
                  <button type="button" className="cu-shutter" onClick={shootCountdown} disabled={countdown !== null} aria-label="Take photo"><span /></button>
                  <span className="cu-cam-gap" />
                </div>
              )}
            </div>
            <canvas ref={canvasRef} hidden />
            {cameraError && <p className="ui-field-error ag-center" role="alert"><Icons.error size={16} aria-hidden="true" /> {cameraError}</p>}
            {!cameraOn && !photo && (
              <ul className="cu-tips">
                <li><Icons.check size={16} aria-hidden="true" /> Stand somewhere with good light</li>
                <li><Icons.check size={16} aria-hidden="true" /> Take off hats and sunglasses</li>
                <li><Icons.check size={16} aria-hidden="true" /> Look straight at the camera</li>
              </ul>
            )}
            {!cameraOn && (
              <div className="cu-actions">
                {photo
                  ? <>{cta('Use this photo', advance)}<button type="button" className="ui-btn ui-btn--plain cu-cta-2" onClick={() => { setPhoto(null); startCamera() }}>Take it again</button></>
                  : cta(cameraError ? 'Try again' : 'Open camera', startCamera)}
              </div>
            )}
          </>
        )}

        {screen === 'amount' && (
          <>
            <h1 className="cu-q">How much will you save?</h1>
            <p className="cu-lead">You give this to your agent {UNIT[cadence].every}.</p>
            <div className="ui-segment cu-seg" role="group" aria-label="How often">
              {(['daily', 'weekly', 'monthly'] as const).map(c => (
                <button key={c} type="button" aria-pressed={cadence === c} onClick={() => setCadenceKeepingLength(c)}>
                  {c === 'daily' ? 'Daily' : c === 'weekly' ? 'Weekly' : 'Monthly'}
                </button>
              ))}
            </div>
            <div className="cu-amount">
              <AmountField
                value={String(Math.round(perPayment(draft)) || '')}
                onChange={v => { const n = Number(v) || 0; setDaily(Math.max(0, n / UNIT[cadence].days)) }}
                label={`Amount ${UNIT[cadence].per}`}
              />
              <span className="cu-amount-per">{UNIT[cadence].per}</span>
            </div>
            <div className="cu-presets" role="group" aria-label="Quick amounts">
              {PRESETS[cadence].map(n => (
                <button key={n} type="button" className="ag-chip" aria-pressed={Math.round(perPayment(draft)) === n} onClick={() => setDaily(n / UNIT[cadence].days)}>
                  {formatNaira(n, { minor: false })}
                </button>
              ))}
            </div>
            <div className="cu-actions">{cta('Continue', () => go('length'), daily <= 0)}</div>
          </>
        )}

        {screen === 'length' && (
          <>
            <h1 className="cu-q">For how long?</h1>
            <p className="cu-lead">Saving {formatNaira(perPayment(draft), { minor: false })} {UNIT[cadence].per}. Pick when you want to collect.</p>
            <div className="ag-tf-wrap cu-start">
              <div className="ag-tf cu-tf">
                <label className="ag-tf-label" htmlFor="plan-start">Starts on</label>
                <input id="plan-start" className="ag-tf-input" type="date" min={isoDate(today())} value={planStart || isoDate(today())}
                  onChange={e => {
                    const v = !e.target.value || e.target.value === isoDate(today()) ? '' : e.target.value
                    setPlanStart(v)
                    // Keep a chosen end date where it is; the length changes instead.
                    if (customEnd) { const d = endDateDays(customEnd, parseDateInput(v) ?? today(), cadence); if (d) setPeriod(d / UNIT[cadence].days) }
                  }} />
              </div>
              <p className="ag-fineprint">{planStart ? `Your plan starts on ${formatDate(startDay)}.` : 'Starts today. Pick a later day if you’d rather.'}</p>
            </div>
            <div className="cu-options" role="radiogroup" aria-label="How long">
              {DURATIONS.map(days => {
                const value = Math.round(days / UNIT[cadence].days)
                const p = { ...draft, period: value }
                return (
                  <button key={days} type="button" role="radio" aria-checked={!customEnd && period === value} className="cu-option" onClick={() => { setPeriod(value); setCustomEnd('') }}>
                    <span className="cu-option-main">
                      <span className="cu-option-title">{value} {UNIT[cadence].plural}</span>
                      <span className="cu-option-sub">Until {formatDate(endDate(p))}</span>
                    </span>
                    <span className="cu-option-end">{formatNaira(totalSaved(p), { minor: false })}</span>
                    <span className="ui-radio" aria-hidden="true" />
                  </button>
                )
              })}
              <button type="button" role="radio" aria-checked={!!customEnd} className="cu-option" onClick={() => { if (!customEnd) setCustomEnd(isoDate(endDate(draft))) }}>
                <span className="cu-goal-icon cu-goal-icon--sm" aria-hidden="true"><Icons.calendar size={18} strokeWidth={1.75} /></span>
                <span className="cu-option-main">
                  <span className="cu-option-title">Choose an end date</span>
                  <span className="cu-option-sub">{customEnd ? `Until ${formatDate(endDate(draft))}` : 'Pick the day you want to collect'}</span>
                </span>
                {customEnd && <span className="cu-option-end">{formatNaira(totalSaved(draft), { minor: false })}</span>}
                <span className="ui-radio" aria-hidden="true" />
              </button>
            </div>
            {customEnd && (
              <div className="cu-enddate">
                <EndDateField start={startDay} cadence={cadence} value={customEnd}
                  onChange={(v, days) => { setCustomEnd(v); if (days) setPeriod(days / UNIT[cadence].days) }} />
              </div>
            )}
            <p className="cu-note">The amount on the right is what you’ll have saved; a platform fee is taken when you collect.</p>
            <div className="cu-actions">{cta('Continue', () => { if (startGoal && plans.length === 0 && editing < 0) savePlan(); else go('goal') }, !!customEnd && endDateInvalid)}</div>
          </>
        )}

        {screen === 'goal' && (
          <>
            <h1 className="cu-q">What are you saving for?</h1>
            <p className="cu-lead">It’s the name of your plan. You can have more than one plan.</p>
            <div className="cu-options cu-options--tight" role="radiogroup" aria-label="Goal">
              {GOAL_META.map(m => {
                const Icon = Icons[m.icon]
                return (
                <button key={m.value} type="button" role="radio" aria-checked={goal === m.value} className="cu-option" onClick={() => setGoal(m.value)}>
                  <span className="cu-goal-icon cu-goal-icon--sm" aria-hidden="true"><Icon size={18} strokeWidth={1.75} /></span>
                  <span className="cu-option-main"><span className="cu-option-title">{m.label}</span></span>
                  <span className="ui-radio" aria-hidden="true" />
                </button>
                )
              })}
            </div>
            <div className="cu-actions">{cta(editing >= 0 ? 'Save plan' : 'Continue', savePlan)}</div>
          </>
        )}

        {screen === 'review' && (
          <>
            <h1 className="cu-q">Check your details</h1>
            <p className="cu-lead">Tap Edit to change anything before you open your account.</p>
            <FormError message={error} />

            <div className="cu-person">
              {photo ? <img src={photo} alt="" /> : <span className="ui-avatar" aria-hidden="true">{firstName[0]}{lastName[0]}</span>}
              <div className="cu-person-main">
                <p className="cu-person-name">{firstName} {lastName}</p>
                <p className="cu-option-sub">{phone}</p>
              </div>
              <button type="button" className="cu-edit" onClick={() => editFromReview('photo')}>Change photo</button>
            </div>

            <h2 className="cu-h2">About you</h2>
            <dl className="cu-list">
              <Row k="Name" v={`${firstName} ${lastName}`.trim()} onEdit={() => editFromReview('name')} />
              <Row k="Phone and email" v={<>{phone}<br />{email}</>} onEdit={() => editFromReview('contact')} />
              <Row k="Home" v={<>{address}{state && <><br />{lga ? `${lga}, ` : ''}{state}</>}{(dob || gender) && <><br />{[dob && formatDate(dob), gender].filter(Boolean).join(' · ')}</>}</>} onEdit={() => editFromReview('home')} />
              <Row k="BVN" v={bvn ? `•••••••${bvn.slice(-4)}` : 'Not added'} onEdit={() => editFromReview('bvn')} />
              <Row k="Emergency contact" v={<>{nokName} ({nokRelation}){nokPhone && <><br />{nokPhone}</>}</>} onEdit={() => editFromReview('nok')} />
            </dl>

            <h2 className="cu-h2">{plans.length > 1 ? `Savings plans (${plans.length})` : 'Savings plan'}</h2>
            <ul className="cu-plans">
              {plans.map((p, i) => (
                <li key={i}>
                  {(() => { const m = goalMeta(p.goal); const Icon = Icons[m.icon]; return <span className="cu-goal-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.75} /></span> })()}
                  <span className="cu-option-main">
                    <span className="cu-option-title">{goalMeta(p.goal).label}</span>
                    <span className="cu-option-sub">{formatNaira(perPayment(p), { minor: false })} {UNIT[p.cadence].per} · {p.start ? `${formatDate(startOf(p))} to ` : 'until '}{formatDate(endDate(p))}</span>
                    <span className="cu-plan-total">{formatNaira(totalSaved(p), { minor: false })} saved by the end</span>
                  </span>
                  <span className="cu-plan-acts">
                    <button type="button" className="cu-edit" onClick={() => editPlan(i)}>Edit</button>
                    {plans.length > 1 && <button type="button" className="cu-edit cu-edit--danger" onClick={() => setPlans(ps => ps.filter((_, j) => j !== i))}>Remove</button>}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="cu-add" onClick={addPlan}><Icons.add size={18} aria-hidden="true" /> Add another plan</button>

            <button type="button" role="checkbox" aria-checked={terms} className={`ag-agree cu-agree${terms ? ' is-on' : ''}`} onClick={() => { setTerms(t => !t); setError('') }}>
              <span className="ag-agree-box" aria-hidden="true">{terms && <Icons.check size={16} />}</span>
              <span>I agree to the Vochus Easy Save terms and conditions, including the platform fee taken when I collect my savings.</span>
            </button>

            <div className="cu-actions">
              {cta(loading ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Opening your account…</> : 'Open my account', createAccount, !terms || loading)}
            </div>
          </>
        )}
      </main>

      <BottomSheet open={otpScreen} onClose={() => setOtpScreen(false)} title="Check your email">
        <p className="ag-sheet-text">We sent a 6-digit code to <strong>{email}</strong>. It can take a minute; check your spam folder too.</p>
        <CodeBoxes value={otpCode} onChange={v => { setOtpCode(v); setOtpError('') }} onComplete={verifyEmailCode} label="Email code" error={!!otpError} errorId="otp-err" autoFocus />
        <FieldError id="otp-err" message={otpError} />
        <div className="ui-stack cu-otp-actions">
          <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={otpCode.length !== 6 || otpLoading} onClick={verifyEmailCode}>
            {otpLoading ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Checking…</> : 'Confirm email'}
          </button>
          <button type="button" className="ui-btn ui-btn--plain ui-btn--block" disabled={otpLoading || resendIn > 0} onClick={resendEmailCode}>{resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}</button>
        </div>
      </BottomSheet>
    </div>
  )
}

const DRAFT_KEY = 'vochus.enrolDraft'
const DRAFT_TTL = 24 * 60 * 60 * 1000

type Draft = {
  v: 1; savedAt: number; aid: string; ref: string; screen: Screen
  firstName: string; lastName: string; phone: string; email: string; verifiedEmail: string
  dob: string; gender: string; address: string; state?: string; lga?: string; nokName: string; nokRelation: string; nokPhone: string
  plans: PlanDraft[]; plan: PlanDraft; startGoal?: string
}

/** Storage can be missing or blocked (private mode, WebView settings), so every call is guarded. */
function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<Draft>
    if (d.v !== 1 || typeof d.savedAt !== 'number' || Date.now() - d.savedAt > DRAFT_TTL || !SCREENS.includes(d.screen as Screen)) {
      window.localStorage.removeItem(DRAFT_KEY)
      return null
    }
    return d as Draft
  } catch { return null }
}
function writeDraft(d: Draft) {
  try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* not saved; the form still works */ }
}
function clearDraft() {
  try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* nothing to clear */ }
}
function timeAgo(t: number) {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 2) return 'a moment ago'
  if (m < 60) return `${m} minutes ago`
  const h = Math.round(m / 60)
  return h === 1 ? 'an hour ago' : `${h} hours ago`
}

function Field({ id, label, hint, error, badge, valid, children }: { id: string; label: string; hint?: string; error?: string; badge?: ReactNode; valid?: boolean; children: ReactNode }) {
  return (
    <div className="ag-tf-wrap">
      <div className={`ag-tf cu-tf${error ? ' is-invalid' : ''}`}>
        <label className="ag-tf-label" htmlFor={id}>{label}</label>
        {children}
        {badge ? <span className="cu-tf-badge">{badge}</span> : valid && !error ? <span className="cu-tf-badge cu-tf-tick" aria-hidden="true"><Icons.check size={14} strokeWidth={3} /></span> : null}
      </div>
      {error ? <FieldError id={`${id}-error`} message={error} /> : hint ? <p className="ag-fineprint">{hint}</p> : null}
    </div>
  )
}

function Choices({ labelledBy, options, value, onChange }: { labelledBy: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="cu-choices" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map(o => <button key={o} type="button" role="radio" aria-checked={value === o} className="cu-choice" onClick={() => onChange(o)}>{o}</button>)}
    </div>
  )
}

function Row({ k, v, onEdit }: { k: string; v: ReactNode; onEdit: () => void }) {
  return (
    <div className="cu-row">
      <div className="cu-row-main"><dt>{k}</dt><dd>{v}</dd></div>
      <button type="button" className="cu-edit" onClick={onEdit} aria-label={`Edit ${k.toLowerCase()}`}>Edit</button>
    </div>
  )
}

/** A plain head-and-shoulders outline for the empty photo frame. */
function FaceOutline() {
  return (
    <svg viewBox="0 0 120 160" width="62%" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <ellipse cx="60" cy="62" rx="27" ry="33" />
      <path d="M14 158c4-30 22-44 46-44s42 14 46 44" />
    </svg>
  )
}

export default function EnrollPage() {
  return (
    <Suspense fallback={<div className="ui-screen ui-screen--center"><span className="ui-spinner" aria-label="Loading" /></div>}>
      <EnrollContent />
    </Suspense>
  )
}
