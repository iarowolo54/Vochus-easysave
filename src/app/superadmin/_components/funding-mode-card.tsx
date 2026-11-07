'use client'
// Super admin: how money comes IN — agents topping up their wallet and customers saving online.
// Bank transfer (the company system) or Card (Paystack). Card stays greyed out while Paystack is switched off.
import { useCallback, useEffect, useState } from 'react'
import { ConfirmModal, Field, LoadError, TableSkeleton, useToast } from './admin-ui'
import type { FundingChannel, FundingMethod, FundingMode } from '@/lib/funding-mode'

const ROWS: { ch: FundingChannel; title: string; transfer: string; card: string }[] = [
  { ch: 'agent', title: 'Agent wallet top-ups', transfer: 'Bank transfer. Agents send money to the Moniepoint account; it is credited from the bank alert, or by staff by hand.', card: 'Card. Agents pay with Paystack (card, transfer or USSD) and the wallet is credited straight away.' },
  { ch: 'customer', title: 'Customer online savings', transfer: 'Bank transfer. Customers send money to the Moniepoint account; it is credited from the bank alert, or by staff by hand.', card: 'Card. Customers pay with Paystack, and automatic saving from a card is available again.' },
]
const LABEL: Record<FundingMethod, string> = { transfer: 'Bank transfer', card: 'Card (Paystack)' }

export function FundingModeCard() {
  const [mode, setMode] = useState<FundingMode | null>(null)
  const [paystackOn, setPaystackOn] = useState(false)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState<FundingMode | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toastNode, toast] = useToast()

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/admin/funding-mode', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const d = await res.json() as { mode: FundingMode; paystackEnabled: boolean }
      setMode(d.mode); setPaystackOn(d.paystackEnabled)
    } catch { setFailed(true) }
  }, [])
  useEffect(() => { load() }, [load])

  async function save() {
    if (!pending) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/admin/funding-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: pending, pin }) })
      const d = await res.json().catch(() => ({})) as { error?: string; mode?: FundingMode }
      if (!res.ok || !d.mode) { setError(d.error ?? 'It wasn’t saved. Nothing changed. Try again.'); return }
      setMode(d.mode); setPending(null); setPin('')
      toast('Top-up method saved', 'success')
    } catch {
      setError('No connection. Check your internet and try again.')
    } finally { setBusy(false) }
  }

  return (
    <section className="card am-section" aria-labelledby="fm-h">
      {toastNode}
      <div className="card-hd">
        <div>
          <h3 id="fm-h">How money comes in</h3>
          <p className="am-card-sub">Agents and customers see only the method chosen here. Payments already started the other way are still credited.</p>
        </div>
      </div>
      {failed ? <LoadError what="the top-up method" onRetry={load} />
        : !mode ? <TableSkeleton rows={2} cols={2} />
        : (
          <>
            {!paystackOn && (
              <div className="a-alert a-alert-a" role="status">Paystack is switched off, so everyone uses bank transfer. Card can be chosen once Paystack is back on.</div>
            )}
            {ROWS.map(r => (
              <div key={r.ch} className="am-rate-group fm-row">
                <h4 id={`fm-${r.ch}`}>{r.title}</h4>
                <p className="am-card-sub">{mode[r.ch] === 'card' ? r.card : r.transfer}</p>
                <div className="seg" role="group" aria-labelledby={`fm-${r.ch}`}>
                  {(['transfer', 'card'] as FundingMethod[]).map(m => (
                    <button key={m} type="button" aria-pressed={mode[r.ch] === m} disabled={m === 'card' && !paystackOn}
                      title={m === 'card' && !paystackOn ? 'Paystack is switched off' : undefined}
                      onClick={() => { if (mode[r.ch] !== m) { setError(''); setPending({ ...mode, [r.ch]: m }) } }}>
                      {LABEL[m]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      {pending && mode && (
        <ConfirmModal icon="rate" title="Change how money comes in?" confirmLabel="Save" busy={busy} error={error}
          body={<>
            {ROWS.filter(r => pending[r.ch] !== mode[r.ch]).map(r => (
              <p key={r.ch}><strong>{r.title}:</strong> {LABEL[mode[r.ch]]} → {LABEL[pending[r.ch]]}</p>
            ))}
            <p>New payments use the new method straight away. Any already started the other way are still credited.</p>
            <Field id="fm-pin" label="Your approval PIN">
              <input id="fm-pin" className="a-input" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={e => setPin(e.target.value)} />
            </Field>
          </>}
          onConfirm={save}
          onClose={() => { if (!busy) { setPending(null); setPin('') } }} />
      )}
    </section>
  )
}
