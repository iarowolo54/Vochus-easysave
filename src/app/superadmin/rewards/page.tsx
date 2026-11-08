'use client'

import { useCallback, useEffect, useState } from 'react'
import { blockMinus, nonNegativeString } from '@/lib/numeric'
import { Icons } from '@/components/ui/icons'
import {
  ConfirmModal, Empty, Field, LoadError, Modal, PageHeader, Pager, RowMenu, TableSkeleton, naira, shortDate, useToast,
} from '../_components/admin-ui'

interface RewardPromo {
  id: string; name: string; startDate: string; endDate: string
  offlineRewardAmount: number; onlineRewardAmount: number; isActive: boolean; createdAt: string
}

interface AgentReward {
  id: string; agentId: string; customerId: string; type: string; amount: number
  narration: string; createdAt: string
  agent: { name: string; agentId: string }
  customer: { firstName: string; lastName: string; customerId: string }
  promo: { name: string }
}

interface PromoForm {
  name: string; startDate: string; endDate: string
  offlineRewardAmount: string; onlineRewardAmount: string
}
type FormErrors = Partial<Record<keyof PromoForm, string>>

const PAGE_SIZE = 25
const EMPTY_FORM: PromoForm = { name: 'Registration Reward', startDate: '', endDate: '', offlineRewardAmount: '200', onlineRewardAmount: '500' }

function isoDate(s: string) { return s ? new Date(s).toISOString().slice(0, 10) : '' }

async function errorOf(res: Response, fallback: string) {
  const d = await res.json().catch(() => ({})) as { error?: string }
  return d.error ?? fallback
}

function validate(f: PromoForm): FormErrors {
  const e: FormErrors = {}
  if (!f.startDate) e.startDate = 'Choose the first day of the promo.'
  if (!f.endDate) e.endDate = 'Choose the last day of the promo.'
  else if (f.startDate && f.endDate < f.startDate) e.endDate = 'The end date must be on or after the start date.'
  if (f.offlineRewardAmount.trim() === '' || !Number.isFinite(parseFloat(f.offlineRewardAmount))) e.offlineRewardAmount = 'Enter an amount. Use 0 for no reward.'
  if (f.onlineRewardAmount.trim() === '' || !Number.isFinite(parseFloat(f.onlineRewardAmount))) e.onlineRewardAmount = 'Enter an amount. Use 0 for no reward.'
  return e
}

export default function RewardsPage() {
  const [promos, setPromos] = useState<RewardPromo[]>([])
  const [rewards, setRewards] = useState<AgentReward[]>([])
  const [totalAmount, setTotalAmount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [histPage, setHistPage] = useState(1)
  const [toastNode, toast] = useToast()

  // Create / edit: form, then a review step
  const [showForm, setShowForm] = useState(false)
  const [step, setStep] = useState<'form' | 'review'>('form')
  const [editPromo, setEditPromo] = useState<RewardPromo | null>(null)
  const [form, setForm] = useState<PromoForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Activate / deactivate / delete
  const [action, setAction] = useState<{ kind: 'toggle' | 'delete'; promo: RewardPromo } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch('/api/admin/rewards')
      if (!res.ok) throw new Error()
      const d = await res.json() as { promos?: RewardPromo[]; rewards?: AgentReward[]; totalAmount?: number; totalCount?: number }
      setPromos(d.promos ?? [])
      setRewards(d.rewards ?? [])
      setTotalAmount(d.totalAmount ?? 0)
      setTotalCount(d.totalCount ?? 0)
      setLoaded(true)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  function openNew() {
    setEditPromo(null); setForm(EMPTY_FORM); setErrors({}); setErr(''); setStep('form'); setShowForm(true)
  }

  function openEdit(p: RewardPromo) {
    setEditPromo(p)
    setForm({
      name: p.name,
      startDate: isoDate(p.startDate),
      endDate: isoDate(p.endDate),
      offlineRewardAmount: String(p.offlineRewardAmount),
      onlineRewardAmount: String(p.onlineRewardAmount),
    })
    setErrors({}); setErr(''); setStep('form'); setShowForm(true)
  }

  function setField<K extends keyof PromoForm>(k: K, v: string) {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: undefined }))
  }

  function review() {
    const e = validate(form)
    setErrors(e)
    if (Object.keys(e).length === 0) { setErr(''); setStep('review') }
  }

  async function savePromo() {
    if (!form.startDate || !form.endDate) { setErr('Start and end dates are required.'); setStep('form'); return }
    setSaving(true); setErr('')
    try {
      const url = editPromo ? `/api/admin/rewards/${editPromo.id}` : '/api/admin/rewards'
      const method = editPromo ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (!res.ok) { setErr(await errorOf(res, editPromo ? 'The promo wasn’t updated. Try again.' : 'The promo wasn’t created. Try again.')); return }
      toast(editPromo ? `${form.name || 'Promo'} updated` : `${form.name || 'Promo'} created and switched on`, 'success')
      setShowForm(false)
      load()
    } catch {
      setErr('No connection. Check your internet and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function runAction() {
    if (!action) return
    const p = action.promo
    setActionBusy(true); setActionError('')
    try {
      const res = action.kind === 'toggle'
        ? await fetch(`/api/admin/rewards/${p.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !p.isActive }),
        })
        : await fetch(`/api/admin/rewards/${p.id}`, { method: 'DELETE' })
      if (!res.ok) {
        setActionError(await errorOf(res, action.kind === 'delete'
          ? 'The promo wasn’t deleted. If agents have already earned rewards from it, switch it off instead.'
          : 'That didn’t go through. Try again.'))
        return
      }
      toast(action.kind === 'delete' ? `${p.name} deleted` : p.isActive ? `${p.name} switched off` : `${p.name} switched on`, 'success')
      setAction(null)
      load()
    } catch {
      setActionError('No connection. Check your internet and try again.')
    } finally {
      setActionBusy(false)
    }
  }

  const activePromo = promos.find(p => p.isActive)
  const firstLoad = loading && !loaded
  const histShown = rewards.slice((histPage - 1) * PAGE_SIZE, histPage * PAGE_SIZE)
  const offlineNum = parseFloat(form.offlineRewardAmount) || 0
  const onlineNum = parseFloat(form.onlineRewardAmount) || 0

  return (
    <>
      <PageHeader
        title="Rewards"
        sub="While a promo is on, an agent earns a reward when a customer they registered makes their first deposit. No deposit, no reward."
        actions={<button type="button" className="btn btn-green" onClick={openNew}><Icons.add size={18} aria-hidden="true" /> New promo</button>}
      />

      {failed && !loaded ? (
        <section className="card"><LoadError what="rewards" onRetry={load} /></section>
      ) : (
        <>
          <div className="stats-grid am-stats-3">
            <div className="stat">
              <div className="stat-lbl">Rewards paid to agents</div>
              <div className="stat-val">{firstLoad ? '—' : naira(totalAmount)}</div>
              <div className="stat-sub">All time</div>
            </div>
            <div className="stat">
              <div className="stat-lbl">Rewards given</div>
              <div className="stat-val">{firstLoad ? '—' : totalCount.toLocaleString('en-NG')}</div>
              <div className="stat-sub">One per registered customer</div>
            </div>
            <div className="stat">
              <div className="stat-lbl">Promo running now</div>
              <div className="stat-val am-active-name">{firstLoad ? '—' : activePromo ? activePromo.name : 'None'}</div>
              <div className="stat-sub">{activePromo ? `Until ${shortDate(activePromo.endDate)}` : 'Agents aren’t earning rewards'}</div>
            </div>
          </div>

          <section className="card am-section" aria-labelledby="promos-h">
            <div className="card-hd"><h3 id="promos-h">Promos</h3></div>
            {firstLoad ? <TableSkeleton rows={3} cols={5} />
              : promos.length === 0 ? <Empty icon="gift" title="No promos yet" text="Create one to start rewarding agents for new customers."
                  action={<button type="button" className="btn btn-green" onClick={openNew}>New promo</button>} />
              : (
                <div className="tbl-wrap tbl-stack">
                  <table>
                    <thead>
                      <tr><th>Promo</th><th>Runs</th><th className="num">Agent registers</th><th className="num">Customer self-registers</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
                    </thead>
                    <tbody>
                      {promos.map(p => (
                        <tr key={p.id}>
                          <td className="td-name">{p.name}</td>
                          <td className="am-muted am-nowrap" data-label="Runs">{shortDate(p.startDate)} to {shortDate(p.endDate)}</td>
                          <td className="num am-strong" data-label="Agent registers">{naira(p.offlineRewardAmount)}</td>
                          <td className="num am-strong" data-label="Customer self-registers">{naira(p.onlineRewardAmount)}</td>
                          <td data-label="Status"><span className={`bdg ${p.isActive ? 'bdg-g' : 'bdg-grey'}`}>{p.isActive ? 'On' : 'Off'}</span></td>
                          <td>
                            <div className="a-row-actions">
                              <button type="button" className="btn btn-sm btn-outline" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>Edit</button>
                              <RowMenu label={`More actions for ${p.name}`} items={[
                                { label: p.isActive ? 'Switch off' : 'Switch on', onSelect: () => { setActionError(''); setAction({ kind: 'toggle', promo: p }) } },
                                { label: 'Delete promo', danger: true, onSelect: () => { setActionError(''); setAction({ kind: 'delete', promo: p }) } },
                              ]} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </section>

          <section className="card" aria-labelledby="hist-h">
            <div className="card-hd">
              <div>
                <h3 id="hist-h">Recent rewards</h3>
                <p className="am-card-sub">The latest 100 rewards.</p>
              </div>
            </div>
            {firstLoad ? <TableSkeleton rows={5} cols={5} />
              : rewards.length === 0 ? <Empty icon="history" title="No rewards given yet" text="Rewards show here when a customer registered during a promo makes their first deposit." />
              : (
                <>
                  <div className="tbl-wrap tbl-stack">
                    <table>
                      <thead>
                        <tr><th>Agent</th><th>Customer</th><th>How they joined</th><th className="num">Amount</th><th>Promo</th><th>Date</th></tr>
                      </thead>
                      <tbody>
                        {histShown.map(r => (
                          <tr key={r.id}>
                            <td>
                              <span className="td-name ui-block">{r.agent.name}</span>
                              <span className="td-sub ui-block">{r.agent.agentId}</span>
                            </td>
                            <td data-label="Customer">
                              <span className="ui-block">{r.customer.firstName} {r.customer.lastName}</span>
                              <span className="td-sub ui-block">{r.customer.customerId}</span>
                            </td>
                            <td data-label="How they joined"><span className={`bdg ${r.type === 'online' ? 'bdg-b' : 'bdg-g'}`}>{r.type === 'online' ? 'Self-registered' : 'Agent registered'}</span></td>
                            <td className="num am-strong" data-label="Amount">{naira(r.amount)}</td>
                            <td className="am-muted" data-label="Promo">{r.promo.name}</td>
                            <td className="am-muted am-nowrap" data-label="Date">{shortDate(r.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={histPage} pageSize={PAGE_SIZE} total={rewards.length} onPage={setHistPage} />
                </>
              )}
          </section>
          {failed && loaded && <p className="a-alert a-alert-a am-refresh-err" role="status">We couldn’t refresh rewards. What you see may be out of date. <button type="button" className="card-link" onClick={load}>Try again</button></p>}
        </>
      )}

      {showForm && (
        <Modal error={err || undefined} icon="gift"
          title={step === 'review' ? 'Check the promo' : editPromo ? `Edit ${editPromo.name}` : 'New promo'}
          sub={step === 'form' ? 'Set how much agents earn for each new customer, and when.' : undefined}
          onClose={() => setShowForm(false)} busy={saving}
          footer={step === 'form' ? <>
            <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="button" className="btn btn-green" onClick={review}>Continue</button>
          </> : <>
            <button type="button" className="btn btn-outline" onClick={() => setStep('form')} disabled={saving}>Back</button>
            <button type="button" className="btn btn-green" onClick={savePromo} disabled={saving}>{saving ? 'Saving…' : editPromo ? 'Save changes' : 'Create promo'}</button>
          </>}>
          {step === 'form' ? (
            <form onSubmit={e => { e.preventDefault(); review() }} noValidate>
              <Field id="pr-name" label="Promo name">
                <input id="pr-name" className="a-input" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. Registration Reward" />
              </Field>
              <div className="am-2col">
                <Field id="pr-start" label="Starts" error={errors.startDate}>
                  <input id="pr-start" className="a-input" type="date" value={form.startDate} aria-invalid={!!errors.startDate} onChange={e => setField('startDate', e.target.value)} />
                </Field>
                <Field id="pr-end" label="Ends" error={errors.endDate}>
                  <input id="pr-end" className="a-input" type="date" value={form.endDate} min={form.startDate || undefined} aria-invalid={!!errors.endDate} onChange={e => setField('endDate', e.target.value)} />
                </Field>
              </div>
              <div className="am-2col">
                <Field id="pr-off" label="Agent registers a customer" hint="In person, in the agent app." error={errors.offlineRewardAmount}>
                  <div className="am-money">
                    <span aria-hidden="true">₦</span>
                    <input id="pr-off" className="a-input" type="tel" inputMode="decimal" autoComplete="off" placeholder="200" value={form.offlineRewardAmount}
                      aria-invalid={!!errors.offlineRewardAmount} onKeyDown={blockMinus} onChange={e => setField('offlineRewardAmount', nonNegativeString(e.target.value))} />
                  </div>
                </Field>
                <Field id="pr-on" label="Customer self-registers" hint="Through the agent’s referral link." error={errors.onlineRewardAmount}>
                  <div className="am-money">
                    <span aria-hidden="true">₦</span>
                    <input id="pr-on" className="a-input" type="tel" inputMode="decimal" autoComplete="off" placeholder="500" value={form.onlineRewardAmount}
                      aria-invalid={!!errors.onlineRewardAmount} onKeyDown={blockMinus} onChange={e => setField('onlineRewardAmount', nonNegativeString(e.target.value))} />
                  </div>
                </Field>
              </div>
            </form>
          ) : (
            <>
              <dl className="dlg-ledger">
                <div><dt>Promo</dt><dd>{form.name || 'Registration Reward'}</dd></div>
                <div><dt>Runs</dt><dd>{shortDate(form.startDate)} to {shortDate(form.endDate)}</dd></div>
                <div><dt>Agent registers a customer</dt><dd className="dlg-strong">{naira(offlineNum)}</dd></div>
                <div><dt>Customer self-registers</dt><dd className="dlg-strong">{naira(onlineNum)}</dd></div>
              </dl>
              <p className="dlg-note">
                {editPromo
                  ? 'New amounts apply to rewards not yet paid. Rewards already given don’t change.'
                  : 'The promo is switched on as soon as you create it. Agents are credited automatically for each new customer.'}
              </p>
            </>
          )}
        </Modal>
      )}

      {action?.kind === 'toggle' && (
        <ConfirmModal icon="gift"
          title={action.promo.isActive ? `Switch off ${action.promo.name}?` : `Switch on ${action.promo.name}?`}
          body={action.promo.isActive
            ? <>Agents stop earning rewards from this promo straight away. Rewards already given stay.</>
            : <>Agents earn {naira(action.promo.offlineRewardAmount)} for each customer they register and {naira(action.promo.onlineRewardAmount)} for each self-registered customer, from {shortDate(action.promo.startDate)} to {shortDate(action.promo.endDate)}.</>}
          confirmLabel={action.promo.isActive ? 'Switch off' : 'Switch on'}
          danger={action.promo.isActive}
          busy={actionBusy} error={actionError}
          onConfirm={runAction} onClose={() => setAction(null)}
        />
      )}

      {action?.kind === 'delete' && (
        <ConfirmModal
          title={`Delete ${action.promo.name}?`}
          body={<>This can’t be undone. To stop rewards but keep the record, switch it off instead.</>}
          confirmLabel="Delete promo" danger
          busy={actionBusy} error={actionError}
          onConfirm={runAction} onClose={() => setAction(null)}
        />
      )}

      {toastNode}
    </>
  )
}
