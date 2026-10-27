'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { formatDate, formatNaira, formatTime } from '@/lib/format'
import AmountField from '@/components/ui/AmountField'
import EmptyState from '@/components/ui/EmptyState'
import { FormError } from '@/components/ui/FormErrors'
import ListRow from '@/components/ui/ListRow'
import { ListSkeleton } from '@/components/ui/Skeleton'
import Toast from '@/components/ui/Toast'
import { Icons } from '@/components/ui/icons'

interface Funding { id: string; ref: string; amount: number; method: string; note: string | null; createdAt: string }

declare global {
  interface Window {
    PaystackPop: {
      setup(opts: {
        key: string
        email: string
        amount: number
        ref: string
        metadata?: Record<string, unknown>
        callback: (resp: { reference: string }) => void
        onClose: () => void
      }): { openIframe(): void }
    }
  }
}

const QUICK = [1000, 5000, 10000, 50000]

const MIN = 100

type AgentUser = { id?: string; agentId?: string; email?: string; walletBalance?: number }

export default function WalletPage() {
  return <Suspense><WalletContent /></Suspense>
}

/** Only return to pages inside the agent area, never to another site. */
function safeReturn(v: string | null) {
  return v && v.startsWith('/dashboard/') && !v.startsWith('//') ? v : null
}

function WalletContent() {
  const { data: session, update } = useSession()
  const returnTo = safeReturn(useSearchParams().get('return'))
  const [funded, setFunded] = useState(false)
  const [amount, setAmount] = useState('')
  const [fundings, setFundings] = useState<Funding[] | null>(null)
  const [balance, setBalance] = useState(0)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [paying, setPaying] = useState(false)
  const [paystackReady, setPaystackReady] = useState(false)
  const scriptLoaded = useRef(false)

  const loadFundings = () => {
    fetch('/api/wallet').then(r => r.json()).then(d => {
      setFundings(d.fundings ?? [])
      if (d.balance !== undefined) setBalance(d.balance)
    }).catch(() => setFundings(prev => prev ?? []))
  }

  useEffect(() => {
    const agent = session?.user as AgentUser | undefined
    if (agent?.walletBalance !== undefined) setBalance(agent.walletBalance)
    loadFundings()
  }, [session])

  useEffect(() => {
    if (scriptLoaded.current) return
    scriptLoaded.current = true
    if (window.PaystackPop) { setPaystackReady(true); return }
    const s = document.createElement('script')
    s.src = 'https://js.paystack.co/v1/inline.js'
    s.async = true
    s.onload = () => setPaystackReady(true)
    document.head.appendChild(s)
  }, [])

  async function handlePay() {
    const amt = parseFloat(amount)
    if (!amt || amt < MIN) { setError(`The smallest top-up is ${formatNaira(MIN, { minor: false })}.`); return }

    setPaying(true); setError('')

    let initRes: Response
    let initData: { error?: string; email?: string; reference?: string }
    try {
      initRes = await fetch('/api/wallet/paystack/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      })
      initData = await initRes.json()
    } catch {
      setError('No connection. Check your internet and try again.'); setPaying(false); return
    }
    if (!initRes.ok) { setError(initData.error ?? 'Couldn’t start the payment. Please try again.'); setPaying(false); return }

    if (!window.PaystackPop) { setError('Paystack is still loading. Try again in a moment.'); setPaying(false); return }

    const pubKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? ''
    const agentUser = session?.user as AgentUser | undefined
    const email = initData.email ?? agentUser?.email ?? `${agentUser?.agentId?.toLowerCase()}@vochus.ng`

    const verify = (reference: string) => {
      fetch('/api/wallet/paystack/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
      })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          setPaying(false)
          if (ok || d.alreadyProcessed) {
            setBalance(d.newBalance)
            setAmount('')
            loadFundings()
            update()
            setToast(`${formatNaira(amt, { minor: false })} added to your wallet`)
            setFunded(true)
          } else {
            setError(d.error ?? 'We couldn’t confirm the payment. If you were charged, contact support with the reference.')
          }
        })
        .catch(() => { setPaying(false); setError('We couldn’t confirm the payment. If you were charged, contact support with the reference.') })
    }

    const handler = window.PaystackPop.setup({
      key: pubKey,
      email,
      amount: Math.round(amt * 100),
      ref: initData.reference ?? '',
      metadata: { agentId: agentUser?.id, agentCode: agentUser?.agentId },
      callback: (resp) => { verify(resp.reference) },
      onClose: () => { setPaying(false) },
    })

    handler.openIframe()
  }

  const amt = parseFloat(amount) || 0
  const valid = amt >= MIN
  const totalFunded = (fundings ?? []).reduce((s, f) => s + f.amount, 0)

  return (
    <div className="ag-page">
      {toast && <Toast message={toast} onDone={() => setToast('')} />}

      {returnTo && (
        <div className={`ui-banner ${funded ? 'ui-banner--info' : 'ui-banner--warn'} ag-return`}>
          {funded ? <Icons.check size={18} aria-hidden="true" /> : <Icons.wallet size={18} aria-hidden="true" />}
          <div>{funded ? 'Your wallet is topped up.' : 'Top up, then carry on recording the saving.'}</div>
          <Link href={returnTo} className="ui-btn ui-btn--primary ag-return-btn">{funded ? 'Back to recording' : 'Back'}</Link>
        </div>
      )}

      <div className="ag-home-grid ag-wallet-grid">
        <div className="ag-col">
          <div className="ui-section-head"><h2 id="topup-title">Add money</h2></div>
          <section className="ui-card ag-topup" aria-labelledby="topup-title">
            <div className="ag-topup-balance">
              <span className="ag-topup-icon" aria-hidden="true"><Icons.wallet size={22} /></span>
              <span>
                <span className="ui-row-sub ui-block">Wallet balance</span>
                <span className="ag-topup-balance-value">{formatNaira(balance)}</span>
              </span>
            </div>

            <p className="ui-row-sub">Your wallet pays for the cash savings you record. Top up before you go out to collect.</p>

            <FormError message={error} />

            <AmountField
              value={amount}
              onChange={v => { setAmount(v); setError('') }}
              invalid={!!amount && !valid}
              hint={amount && !valid ? `At least ${formatNaira(MIN, { minor: false })}` : `Minimum ${formatNaira(MIN, { minor: false })}`}
            />

            <div className="ag-quick" role="group" aria-label="Quick amounts">
              {QUICK.map(n => (
                <button key={n} type="button" className="ag-chip" aria-pressed={amt === n} onClick={() => { setAmount(String(n)); setError('') }}>
                  {formatNaira(n, { minor: false })}
                </button>
              ))}
            </div>

            <dl className="ag-done-rows ag-topup-rows">
              <div><dt>You pay</dt><dd>{valid ? formatNaira(amt) : '—'}</dd></div>
              <div><dt>Wallet after</dt><dd className={valid ? 'ag-strong' : undefined}>{valid ? formatNaira(balance + amt) : '—'}</dd></div>
            </dl>

            <button type="button" className="ui-btn ui-btn--primary ui-btn--block ag-topup-btn" disabled={paying || !paystackReady || !valid} onClick={handlePay}>
              {!paystackReady
                ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Loading Paystack…</>
                : paying
                  ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Waiting for payment…</>
                  : valid ? `Pay ${formatNaira(amt, { minor: false })}` : 'Enter an amount'}
            </button>
            <p className="ui-note ui-note--center"><Icons.locked size={16} aria-hidden="true" /> Secured by Paystack · card, bank transfer or USSD</p>
          </section>
        </div>

        <div className="ag-col">
          <div className="ui-section-head"><h2>Top-ups</h2>{fundings && fundings.length > 0 && <span className="ui-card-meta">Last {Math.min(8, fundings.length)}</span>}</div>
          <section className="ui-card ag-funded" aria-label="Total funded">
            <div>
              <span className="ui-row-sub ui-block">Total added</span>
              <span className="ag-funded-value">{formatNaira(totalFunded, { minor: false })}</span>
            </div>
            <span className="ag-funded-count">{fundings ? fundings.length : '–'}<span>top-up{fundings?.length === 1 ? '' : 's'}</span></span>
          </section>
          {fundings === null ? (
            <ListSkeleton count={4} />
          ) : fundings.length === 0 ? (
            <section className="ui-card">
              <EmptyState icon="wallet" title="No top-ups yet" text="Money you add to your wallet will show here." />
            </section>
          ) : (
            <section className="ui-card ui-card--list">
              {fundings.slice(0, 8).map(f => (
                <ListRow
                  key={f.id}
                  icon={f.method === 'Paystack' ? 'card' : 'wallet'}
                  title={f.method === 'Paystack' ? 'Paystack top-up' : 'Wallet funding'}
                  sub={`${formatDate(f.createdAt)} · ${formatTime(f.createdAt)}`}
                  value={<span className="ui-value-stack ui-amount--positive">+{formatNaira(f.amount, { minor: false })}</span>}
                />
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
