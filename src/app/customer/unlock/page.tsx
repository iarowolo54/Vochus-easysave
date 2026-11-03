'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AuthShell from '@/components/auth/AuthShell'
import CodeBoxes from '@/components/ui/CodeBoxes'
import { FieldError, FormError } from '@/components/ui/FormErrors'
import { Icons } from '@/components/ui/icons'
import { RESENT_MESSAGE, useResetId } from '@/components/useResendCooldown'

/**
 * Reopens a customer account that was hard-locked after 4 wrong passwords. The code goes to the customer's
 * registration channel (email or SMS); after verifying, they sign in with their password again.
 * API: POST /api/customer/auth/unlock/request { phone } and /verify { phone, code, resetId }.
 */
export default function UnlockPage() {
  const router = useRouter()
  const [phone, setPhone] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [resent, setResent] = useState(false)
  const [error, setError] = useState('')
  const [codeError, setCodeError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const requestedOnce = useRef(false)
  const { remember, idFor, forget } = useResetId('customer-unlock', (_account, left) => setCooldown(left))

  async function sendCode(p: string) {
    setError('')
    setSending(true)
    try {
      const res = await fetch('/api/customer/auth/unlock/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) {
        const wait = Number(data.retryAfterSeconds) || 60
        setCooldown(wait)
        setError(data.error && !/\d/.test(String(data.error)) ? `${data.error} Try again in ${wait}s.` : `Please wait ${wait}s before asking for another code.`)
        return
      }
      if (!res.ok) { setError(data.error ?? 'We couldn’t send a code. Please try again.'); return }
      setResent(requestedOnce.current && !!idFor(p))
      remember(data.resetId, p)
      setCooldown(60)
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setSending(false)
    }
  }

  // Read the phone from the URL and send the first code automatically.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('phone')?.trim() ?? ''
    setPhone(p)
    // A reload keeps the code already on its way rather than asking for another.
    if (p && !requestedOnce.current && !idFor(p)) sendCode(p)
    requestedOnce.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function verify(value = code) {
    if (!phone) return
    setError(''); setCodeError('')
    if (value.length !== 6) { setCodeError('Enter the 6-digit code.'); return }
    setVerifying(true)
    try {
      const res = await fetch('/api/customer/auth/unlock/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: value, resetId: idFor(phone) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCodeError(data.error === 'Invalid or expired code' || !data.error
          ? 'That code is wrong or has expired. Check it, or ask for a new one.'
          : data.error)
        return
      }
      forget()
      router.push('/customer/login?unlocked=1')
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setVerifying(false)
    }
  }

  const back = (
    <button type="button" className="ui-link" onClick={() => router.push('/customer/login')}>
      <Icons.back size={16} aria-hidden="true" /> Back to sign in
    </button>
  )

  // Still reading the URL.
  if (phone === null) {
    return (
      <div className="ui-screen ui-screen--center">
        <span className="ui-spinner" aria-label="Loading" />
      </div>
    )
  }

  // Arrived without a phone number: nothing to unlock.
  if (!phone) {
    return (
      <AuthShell title="Unlock your account" lead="We couldn’t tell which account to unlock. Go back and sign in with your phone number.">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={() => router.push('/customer/login')}>Back to sign in</button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Unlock your account"
      lead="For your safety, we locked your account after too many wrong passwords. Enter the code we sent you to unlock it."
      footer={back}
    >
      <div className="ui-banner ui-banner--info cu-unlock-sent" role="status" aria-live="polite">
        {sending
          ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /><div>Sending your code…</div></>
          : <><Icons.send size={18} aria-hidden="true" /><div>
              {resent
                ? RESENT_MESSAGE
                : 'If this number has a locked account, we’ve sent a code to the email or phone it was registered with. It can take a minute; check spam too.'}
            </div></>}
      </div>

      <FormError message={error} />

      <div className="ui-field">
        <CodeBoxes value={code} onChange={v => { setCode(v); setCodeError('') }} onComplete={() => verify()}
          label="Unlock code" error={!!codeError} errorId="unlock-code-error" autoFocus />
        <FieldError id="unlock-code-error" message={codeError} />
      </div>

      <button type="button" className="ui-btn ui-btn--primary ui-btn--block" disabled={verifying || code.length !== 6} onClick={() => verify()}>
        {verifying ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Unlocking…</> : 'Unlock my account'}
      </button>

      <button type="button" className="ui-btn ui-btn--plain ui-btn--block cu-unlock-resend" disabled={sending || cooldown > 0} onClick={() => sendCode(phone)}>
        {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
      </button>
    </AuthShell>
  )
}
