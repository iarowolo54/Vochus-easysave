'use client'

import { useState, useEffect, useCallback } from 'react'
import { LoadError, PageHeader, Segmented, TableSkeleton, useToast } from '../_components/admin-ui'
import { PAYSTACK_ENABLED } from '@/lib/paystack-off'
import { FundingModeCard } from '../_components/funding-mode-card'
import { ManualModeBanner, parsePayoutModes, type PayoutModes, type PayoutModeValue } from '../_components/payout-mode'

const OPTIONS: { value: PayoutModeValue; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'manual', label: 'Manual' },
]

export default function PayoutModePage() {
  const [saved, setSaved] = useState<PayoutModes | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<'error' | 'forbidden' | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [toastNode, toast] = useToast()

  const load = useCallback(async () => {
    setLoading(true); setFailed(null)
    try {
      const res = await fetch('/api/admin/payout-mode')
      if (res.status === 401 || res.status === 403) { setFailed('forbidden'); return }
      if (!res.ok) throw new Error()
      const parsed = parsePayoutModes(await res.json().catch(() => null))
      if (!parsed) throw new Error()
      setSaved(parsed)
    } catch {
      setFailed('error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save(next: PayoutModes) {
    setSaving(true); setSaveError('')
    try {
      const res = await fetch('/api/admin/payout-mode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      })
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!res.ok || !d.ok) { setSaveError(d.error ?? 'The payout mode wasn’t changed. Try again.'); return }
      setSaved(next)
      toast('Payout mode saved.', 'success')
    } catch {
      setSaveError('No connection. Check your internet and try again.')
    } finally {
      setSaving(false)
    }
  }

  const anyManual = saved !== null && (saved.agent === 'manual' || saved.customer === 'manual')

  return (
    <>
      <PageHeader
        title="Payouts & top-ups"
        sub="How money comes in (top-ups and online savings) and how it goes out (payouts)."
      />

      {loading ? <TableSkeleton rows={3} cols={2} />
        : failed === 'forbidden' ? (
          <div className="a-alert a-alert-a" role="alert">Only a super admin can change the payout mode. Sign in with a super admin account.</div>
        )
        : failed || !saved ? <LoadError what="the payout mode" onRetry={load} />
        : (
          <>
            {!PAYSTACK_ENABLED && (
              <div className="a-alert a-alert-a" role="status">
                Paystack is closed, so every payout is Manual: pay the person from the bank app, then mark it as paid. Automatic can’t be turned on.
              </div>
            )}
            <FundingModeCard />

            {anyManual && <ManualModeBanner />}

            <section className="card am-section" aria-labelledby="pm-agent">
              <div className="card-hd">
                <div>
                  <h3 id="pm-agent">Agent payouts</h3>
                  <p className="am-card-sub">{saved.agent === 'manual'
                    ? 'Manual. Approving a withdrawal records it as paid. No Paystack transfer is made.'
                    : 'Automatic. Approving a withdrawal sends the money through Paystack.'}</p>
                </div>
              </div>
              <Segmented label="Agent payouts mode" value={saved.agent} options={OPTIONS}
                onChange={v => { if (!saving && v !== saved.agent) save({ ...saved, agent: v }) }} />
            </section>

            <section className="card am-section" aria-labelledby="pm-cust">
              <div className="card-hd">
                <div>
                  <h3 id="pm-cust">Customer redemptions</h3>
                  <p className="am-card-sub">{saved.customer === 'manual'
                    ? 'Manual. Approving a bank-transfer redemption records it as paid. No Paystack transfer is made. Cash payouts are unchanged.'
                    : 'Automatic. Approving a bank-transfer redemption sends the money through Paystack.'}</p>
                </div>
              </div>
              <Segmented label="Customer redemptions mode" value={saved.customer} options={OPTIONS}
                onChange={v => { if (!saving && v !== saved.customer) save({ ...saved, customer: v }) }} />
            </section>

            <div className="a-row-actions">
              <button type="button" className="btn btn-outline" disabled={saving || (saved.agent === 'manual' && saved.customer === 'manual')}
                onClick={() => save({ agent: 'manual', customer: 'manual' })}>Set everything to Manual</button>
              <button type="button" className="btn btn-outline" disabled={saving || (saved.agent === 'auto' && saved.customer === 'auto')}
                onClick={() => save({ agent: 'auto', customer: 'auto' })}>Set everything to Automatic</button>
            </div>

            {saving && <p className="a-hint" role="status">Saving…</p>}
            {saveError && <p className="a-inline-error" role="alert">{saveError}</p>}
          </>
        )}
      {toastNode}
    </>
  )
}
