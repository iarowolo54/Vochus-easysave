'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
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
import TransferPanel, { type TransferDetails } from '@/components/ui/TransferPanel'
import { Icons } from '@/components/ui/icons'

interface Funding { id: string; ref: string; amount: number; method: string; note: string | null; createdAt: string }

const QUICK = [1000, 5000, 10000, 50000]

const MIN = 100

type AgentUser = { walletBalance?: number }

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
  const [transfer, setTransfer] = useState<TransferDetails | null>(null)

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

  async function handlePay() {
    const amt = parseFloat(amount)
    if (!amt || amt < MIN) { setError(`The smallest top-up is ${formatNaira(MIN, { minor: false })}.`); return }
    if (!Number.isInteger(amt)) { setError('Enter a whole-naira amount.'); return }

    setPaying(true); setError('')
    try {
      const res = await fetch('/api/agent/transfer/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      })
      const data = await res.json().catch(() => ({})) as Partial<TransferDetails> & { error?: string }
      if (!res.ok || !data.ref) { setError(data.error ?? 'Couldn’t start the top-up. Please try again.'); return }
      setTransfer(data as TransferDetails)
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally {
      setPaying(false)
    }
  }

  const credited = useCallback((newBalance: number | null) => {
    if (newBalance !== null) setBalance(newBalance)
    setAmount('')
    loadFundings()
    update()
    setToast('Your wallet is topped up')
    setFunded(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          {transfer ? (
            <section className="ui-card ag-topup" aria-labelledby="topup-title">
              <TransferPanel
                details={transfer}
                statusUrl="/api/agent/transfer/status"
                cancelUrl="/api/agent/transfer/cancel"
                destination="your wallet"
                balanceLabel="Your wallet"
                doneHref="/dashboard"
                historyHref="/dashboard/wallet"
                onDone={credited}
                onClose={() => setTransfer(null)}
              />
            </section>
          ) : (
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

            <button type="button" className="ui-btn ui-btn--primary ui-btn--block ag-topup-btn" disabled={paying || !valid} onClick={handlePay}>
              {paying
                ? <><span className="ui-spinner ui-spinner--sm" aria-hidden="true" /> Getting account details…</>
                : valid ? `Pay ${formatNaira(amt, { minor: false })} by transfer` : 'Enter an amount'}
            </button>
            <p className="ui-note ui-note--center"><Icons.locked size={16} aria-hidden="true" /> Next you’ll see the exact amount to send. It has a few extra kobo. Send it exactly, kobo included.</p>
          </section>
          )}
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
                  title={f.method === 'Paystack' ? 'Card top-up' : f.method === 'Transfer' ? 'Bank transfer top-up' : 'Wallet funding'}
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
