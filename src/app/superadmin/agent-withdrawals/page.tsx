'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { digitsOnly, blockNonDigit } from '@/lib/numeric'
import { IN_FLIGHT_WITHDRAWAL_STATUSES } from '@/lib/redemption-statuses'
import { Icons } from '@/components/ui/icons'
import {
  AmountHero, Empty, Field, Ledger, LedgerRow, LoadError, Modal, PageHeader, Pager, TableSkeleton, dateTime, naira, useToast,
  ResultModal, type Result,
} from '../_components/admin-ui'
import { ManualModeBanner, PayoutModeError, usePayoutMode } from '../_components/payout-mode'

interface WithdrawalRecord {
  id: string
  ref: string
  agentId: string
  agentName: string
  agentDisplayId: string
  agentPhone: string
  agentCommissionBalance: number
  amount: number
  note: string | null
  status: string
  bankCode: string | null
  bankName: string | null
  accountNumber: string | null
  accountName: string | null
  bankTransferStatus: string | null
  paystackTransferCode: string | null
  adminNote: string | null
  requestedAt: string
  decidedAt: string | null
  decidedBy: string | null
}

interface PageData {
  pending: number
  approved: number
  rejected: number
  totalPaidOut: number
  records: WithdrawalRecord[]
}

type Tab = 'pending' | 'history'

const PENDING_STATUSES = IN_FLIGHT_WITHDRAWAL_STATUSES
const PAGE_SIZE = 25

const STATUS: Record<string, [cls: string, label: string]> = {
  Pending: ['bdg-a', 'Waiting for approval'],
  AwaitingOTP: ['bdg-a', 'Waiting for OTP'],
  Processing: ['bdg-b', 'Paystack is processing'],
  Finalizing: ['bdg-b', 'Finalising payout'],
  Approved: ['bdg-g', 'Paid'],
  Rejected: ['bdg-r', 'Rejected'],
}
function StatusBadge({ s }: { s: string }) {
  const [cls, label] = STATUS[s] ?? ['bdg-grey', s]
  return <span className={`bdg ${cls}`}>{label}</span>
}

const PAYSTACK: Record<string, string> = {
  success: 'Sent', pending: 'Pending', otp: 'Needs OTP', failed: 'Failed', reversed: 'Reversed', processing: 'Processing', manual: 'Paid manually',
}
const paystackLabel = (s: string | null) => s ? (PAYSTACK[s] ?? s) : '—'
const last4 = (n: string | null) => n ? `••••${n.slice(-4)}` : '—'

async function readJson(res: Response) {
  return await res.json().catch(() => ({})) as { error?: string; status?: string; bankTransferStatus?: string }
}

export default function AgentWithdrawalsPage() {
  const [data, setData] = useState<PageData>({ pending: 0, approved: 0, rejected: 0, totalPaidOut: 0, records: [] })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<Tab>('pending')
  const [histPage, setHistPage] = useState(1)
  const [toastNode, toast] = useToast()
  const [detailRecord, setDetailRecord] = useState<WithdrawalRecord | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const { modes: payoutModes, error: payoutModeError, reload: reloadPayoutMode } = usePayoutMode()
  const manual = payoutModes?.agent === 'manual'
  const [transferRef, setTransferRef] = useState('')

  const [pinModal, setPinModal] = useState<WithdrawalRecord | null>(null)
  const [pinValue, setPinValue] = useState('')
  const [pinError, setPinError] = useState('')
  const [approveError, setApproveError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [pinLoading, setPinLoading] = useState(false)

  const [rejectModal, setRejectModal] = useState<WithdrawalRecord | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [rejectLoading, setRejectLoading] = useState(false)
  const [rejectError, setRejectError] = useState('')

  const [otpModal, setOtpModal] = useState<{ id: string; ref: string; agentName: string; amount: number } | null>(null)
  const [otpValue, setOtpValue] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const res = await fetch('/api/admin/agent-withdrawal')
      if (!res.ok) throw new Error()
      const d = await res.json() as Partial<PageData>
      setData({ pending: d.pending ?? 0, approved: d.approved ?? 0, rejected: d.rejected ?? 0, totalPaidOut: d.totalPaidOut ?? 0, records: d.records ?? [] })
      setLoaded(true)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const pending = data.records.filter(r => PENDING_STATUSES.includes(r.status))
  const history = data.records.filter(r => !PENDING_STATUSES.includes(r.status))
  const historyPage = history.slice((histPage - 1) * PAGE_SIZE, histPage * PAGE_SIZE)

  function openApprove(r: WithdrawalRecord) { setDetailRecord(null); setPinModal(r); setPinValue(''); setPinError(''); setApproveError(''); setTransferRef('') }
  function openReject(r: WithdrawalRecord) { setDetailRecord(null); setRejectModal(r); setRejectNote(''); setRejectError('') }
  function openOtp(r: WithdrawalRecord) { setDetailRecord(null); setOtpModal({ id: r.id, ref: r.ref, agentName: r.agentName, amount: r.amount }); setOtpValue(''); setOtpError('') }

  async function confirmApprove() {
    if (!pinModal) return
    if (!pinValue.trim()) { setPinError('Enter your approval PIN.'); return }
    setPinLoading(true); setPinError(''); setApproveError('')
    try {
      const res = await fetch(`/api/admin/agent-withdrawal/${pinModal.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manual && transferRef.trim() ? { action: 'approve', pin: pinValue, adminNote: transferRef.trim() } : { action: 'approve', pin: pinValue }),
      })
      const d = await readJson(res)
      if (!res.ok) {
        const msg = d.error ?? 'The withdrawal wasn’t approved. Nothing was sent. Try again.'
        if (/pin/i.test(msg)) setPinError(msg); else setApproveError(msg)
        return
      }
      const pend = pinModal
      setPinModal(null); setPinValue('')
      if (d.status === 'AwaitingOTP') {
        setOtpModal({ id: pend.id, ref: pend.ref, agentName: pend.agentName, amount: pend.amount }); setOtpValue(''); setOtpError('')
        toast('Paystack sent an OTP. Enter it to finish the payout.')
      } else {
        const wasManual = d.bankTransferStatus === 'manual'
        const sent = d.bankTransferStatus === 'success' || wasManual
        setResult({
          heading: sent ? 'Withdrawal paid' : 'Withdrawal approved',
          title: wasManual ? `${naira(pend.amount)} marked as paid` : sent ? `${naira(pend.amount)} sent` : 'Paystack is sending the money',
          pending: !sent,
          text: wasManual
            ? <>Recorded as paid manually. No Paystack transfer was made, so make sure {pend.agentName} has been paid.</>
            : sent
            ? <>Paystack has paid {pend.agentName}’s bank account.</>
            : <>It usually lands within minutes. Use <strong>Check status</strong> on the request to confirm it’s paid.</>,
          rows: [
            { label: 'Agent', value: `${pend.agentName} · ${pend.agentDisplayId}` },
            { label: 'Account', value: `${pend.accountName ?? '—'} · ${pend.bankName ?? '—'} ${last4(pend.accountNumber)}` },
            { label: 'Reference', value: pend.ref },
            { label: 'Amount', value: naira(pend.amount), total: true },
          ],
        })
      }
      load()
    } catch {
      setApproveError('No connection. We can’t tell if this went through, so close this and reload before trying again.')
    } finally {
      setPinLoading(false)
    }
  }

  async function confirmReject() {
    if (!rejectModal) return
    setRejectLoading(true); setRejectError('')
    try {
      const res = await fetch(`/api/admin/agent-withdrawal/${rejectModal.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', adminNote: rejectNote }),
      })
      const d = await readJson(res)
      if (!res.ok) { setRejectError(d.error ?? 'The withdrawal wasn’t rejected. Try again.'); return }
      toast(`Rejected. ${naira(rejectModal.amount)} is back in ${rejectModal.agentName}’s commission balance.`, 'success')
      setRejectModal(null); setRejectNote('')
      load()
    } catch {
      setRejectError('No connection. Check your internet and try again.')
    } finally {
      setRejectLoading(false)
    }
  }

  async function verify(id: string) {
    setVerifying(id)
    try {
      const res = await fetch(`/api/admin/agent-withdrawal/${id}/verify`, { method: 'POST' })
      const d = await readJson(res)
      if (!res.ok) { toast(d.error ?? 'We couldn’t check with Paystack. Try again.', 'error'); return }
      const label = d.status ? (STATUS[d.status]?.[1] ?? d.status) : 'unchanged'
      toast(`Paystack says: ${paystackLabel(d.bankTransferStatus ?? null).toLowerCase()}. This request is now: ${label.toLowerCase()}.`)
      load()
    } catch {
      toast('No connection. Check your internet and try again.', 'error')
    } finally {
      setVerifying(null)
    }
  }

  async function submitOtp() {
    if (!otpModal) return
    if (!otpValue.trim()) { setOtpError('Enter the code Paystack sent you.'); return }
    setOtpLoading(true); setOtpError('')
    try {
      const res = await fetch(`/api/admin/agent-withdrawal/${otpModal.id}/finalize-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: otpValue.trim() }),
      })
      const d = await readJson(res)
      if (!res.ok) { setOtpError(d.error ?? 'Paystack didn’t accept the code. Check it and try again.'); return }
      setResult({
        heading: 'Withdrawal paid', title: `${naira(otpModal.amount)} sent`,
        text: <>Paystack accepted the code and paid {otpModal.agentName}.</>,
        rows: [{ label: 'Agent', value: otpModal.agentName }, { label: 'Reference', value: otpModal.ref }, { label: 'Amount', value: naira(otpModal.amount), total: true }],
      })
      setOtpModal(null); setOtpValue('')
      load()
    } catch {
      setOtpError('No connection. Check your internet and try again.')
    } finally {
      setOtpLoading(false)
    }
  }

  function pendingActions(r: WithdrawalRecord) {
    if (r.status === 'AwaitingOTP') return <button type="button" className="btn btn-sm btn-green" onClick={() => openOtp(r)}>Enter OTP</button>
    if (r.status === 'Processing' || r.status === 'Finalizing') return (
      <button type="button" className="btn btn-sm btn-outline" disabled={verifying === r.id} onClick={() => verify(r.id)}>
        {verifying === r.id ? 'Checking…' : 'Check status'}
      </button>
    )
    return <>
      <button type="button" className="btn btn-sm btn-green" onClick={() => openApprove(r)} aria-label={`${manual ? 'Mark as paid' : 'Approve'} ${naira(r.amount)} for ${r.agentName}`}>{manual ? 'Mark as paid' : 'Approve'}</button>
      <button type="button" className="btn btn-sm btn-outline" onClick={() => openReject(r)} aria-label={`Reject ${naira(r.amount)} for ${r.agentName}`}>Reject</button>
    </>
  }

  const firstLoad = loading && !loaded
  const statVal = (v: ReactNode) => firstLoad ? '—' : v

  return (
    <>
      <PageHeader title="Agent withdrawals" sub={manual ? 'Agents asking to withdraw their commission to a bank account. You pay them yourself, then mark the request as paid.' : 'Agents asking to withdraw their commission to a bank account. Approving sends the money through Paystack.'} />
      {payoutModeError && <PayoutModeError onRetry={reloadPayoutMode} />}
      {manual && <ManualModeBanner />}

      <div className="stats-grid">
        <div className="stat"><div className="stat-lbl">Waiting for you</div><div className={`stat-val${data.pending ? ' amber' : ''}`}>{statVal(data.pending.toLocaleString('en-NG'))}</div><div className="stat-sub">Need approval</div></div>
        <div className="stat"><div className="stat-lbl">Paid</div><div className="stat-val">{statVal(data.approved.toLocaleString('en-NG'))}</div><div className="stat-sub">All time</div></div>
        <div className="stat"><div className="stat-lbl">Rejected</div><div className="stat-val">{statVal(data.rejected.toLocaleString('en-NG'))}</div><div className="stat-sub">All time</div></div>
        <div className="stat"><div className="stat-lbl">Total paid out</div><div className="stat-val">{statVal(naira(data.totalPaidOut))}</div></div>
      </div>

      <div className="tab-bar am-tabs" role="tablist" aria-label="Withdrawals">
        <button type="button" role="tab" id="tab-pending" aria-selected={tab === 'pending'} aria-controls="panel-wd" className={`tab${tab === 'pending' ? ' active' : ''}`} onClick={() => setTab('pending')}>
          To do<span className="am-tab-count">{pending.length}</span>
        </button>
        <button type="button" role="tab" id="tab-history" aria-selected={tab === 'history'} aria-controls="panel-wd" className={`tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
          History<span className="am-tab-count">{history.length}</span>
        </button>
      </div>

      <section className="card" id="panel-wd" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {firstLoad ? <TableSkeleton rows={6} cols={6} />
          : failed && !loaded ? <LoadError what="withdrawals" onRetry={load} />
          : tab === 'pending' ? (
            pending.length === 0 ? <Empty icon="check" title="You’re all caught up" text="New withdrawal requests from agents will show here." /> : (
              <div className="tbl-wrap tbl-stack">
                <table>
                  <thead>
                    <tr><th>Agent</th><th>Reference</th><th className="num">Amount</th><th>Pay to</th><th>Note</th><th>Requested</th><th><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {pending.map(r => (
                      <tr key={r.id}>
                        <td>
                          <span className="td-name ui-block">{r.agentName}</span>
                          <span className="td-sub ui-block">{r.agentDisplayId} · {r.agentPhone}</span>
                        </td>
                        <td data-label="Reference">
                          <button type="button" className="am-ref-btn" onClick={() => setDetailRecord(r)} aria-label={`View details of ${r.ref}`}>{r.ref}</button>
                        </td>
                        <td className="num am-strong" data-label="Amount">{naira(r.amount)}</td>
                        <td data-label="Pay to">
                          <span className="ui-block am-strong">{r.accountName ?? '—'}</span>
                          <span className="td-sub ui-block">{r.bankName ?? 'No bank'} · {last4(r.accountNumber)}</span>
                        </td>
                        <td className="am-muted" data-label="Note"><span className="am-clip" title={r.note ?? undefined}>{r.note ?? '—'}</span></td>
                        <td className="am-muted am-nowrap" data-label="Requested">{dateTime(r.requestedAt)}</td>
                        <td>
                          <div className="am-state">
                            {r.status !== 'Pending' && <StatusBadge s={r.status} />}
                            <div className="a-row-actions">{pendingActions(r)}</div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            history.length === 0 ? <Empty icon="history" title="No decisions yet" text="Withdrawals you approve or reject will show here." /> : (
              <>
                <div className="tbl-wrap tbl-stack">
                  <table>
                    <thead>
                      <tr><th>Agent</th><th>Reference</th><th className="num">Amount</th><th>Pay to</th><th>Outcome</th><th>Paystack</th><th>Decided by</th><th>Date</th><th><span className="sr-only">Actions</span></th></tr>
                    </thead>
                    <tbody>
                      {historyPage.map(r => (
                        <tr key={r.id}>
                          <td>
                            <span className="td-name ui-block">{r.agentName}</span>
                            <span className="td-sub ui-block">{r.agentDisplayId}</span>
                          </td>
                          <td data-label="Reference">
                            <button type="button" className="am-ref-btn" onClick={() => setDetailRecord(r)} aria-label={`View details of ${r.ref}`}>{r.ref}</button>
                          </td>
                          <td className="num am-strong" data-label="Amount">{naira(r.amount)}</td>
                          <td className="am-muted" data-label="Pay to">{r.bankName ?? '—'} · {last4(r.accountNumber)}</td>
                          <td data-label="Outcome"><StatusBadge s={r.status} /></td>
                          <td className="am-muted" data-label="Paystack">{paystackLabel(r.bankTransferStatus)}</td>
                          <td className="am-muted" data-label="Decided by">{r.decidedBy ?? '—'}</td>
                          <td className="am-muted am-nowrap" data-label="Date">{r.decidedAt ? dateTime(r.decidedAt) : '—'}</td>
                          <td>
                            {r.paystackTransferCode && (
                              <div className="a-row-actions">
                                <button type="button" className="btn btn-sm btn-outline" disabled={verifying === r.id} onClick={() => verify(r.id)}>
                                  {verifying === r.id ? 'Checking…' : 'Check status'}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={histPage} pageSize={PAGE_SIZE} total={history.length} onPage={setHistPage} />
              </>
            )
          )}
        {failed && loaded && <p className="a-alert a-alert-a am-refresh-err" role="status">We couldn’t refresh this list. What you see may be out of date. <button type="button" className="card-link" onClick={load}>Try again</button></p>}
      </section>

      {detailRecord && (
        <Modal icon="withdraw" title={detailRecord.ref} sub={<StatusBadge s={detailRecord.status} />} onClose={() => setDetailRecord(null)}
          footer={PENDING_STATUSES.includes(detailRecord.status) ? (
            detailRecord.status === 'AwaitingOTP' ? <button type="button" className="btn btn-green" onClick={() => openOtp(detailRecord)}>Enter OTP</button>
              : detailRecord.status === 'Processing' || detailRecord.status === 'Finalizing' ? <button type="button" className="btn btn-outline" disabled={verifying === detailRecord.id} onClick={() => { const id = detailRecord.id; setDetailRecord(null); verify(id) }}>Check status with Paystack</button>
              : <>
                <button type="button" className="btn btn-outline" onClick={() => openReject(detailRecord)}>Reject</button>
                <button type="button" className="btn btn-green" onClick={() => openApprove(detailRecord)}>{manual ? 'Mark as paid' : 'Approve'} {naira(detailRecord.amount)}</button>
              </>
          ) : <button type="button" className="btn btn-outline" onClick={() => setDetailRecord(null)}>Close</button>}>
          <h3 className="dlg-sec-h">Withdrawal</h3>
          <dl className="dlg-ledger">
            <div><dt>Amount</dt><dd className="dlg-strong">{naira(detailRecord.amount)}</dd></div>
            <div><dt>Agent’s note</dt><dd>{detailRecord.note ?? '—'}</dd></div>
            <div><dt>Requested</dt><dd>{dateTime(detailRecord.requestedAt)}</dd></div>
          </dl>
          <h3 className="dlg-sec-h">Agent</h3>
          <dl className="dlg-ledger">
            <div><dt>Name</dt><dd>{detailRecord.agentName}</dd></div>
            <div><dt>Agent ID</dt><dd>{detailRecord.agentDisplayId}</dd></div>
            <div><dt>Phone</dt><dd>{detailRecord.agentPhone}</dd></div>
            <div><dt>Commission balance</dt><dd>{naira(detailRecord.agentCommissionBalance)}</dd></div>
          </dl>
          <h3 className="dlg-sec-h">Pay to</h3>
          <dl className="dlg-ledger">
            <div><dt>Account name</dt><dd>{detailRecord.accountName ?? '—'}</dd></div>
            <div><dt>Bank</dt><dd>{detailRecord.bankName ?? '—'}</dd></div>
            <div><dt>Account number</dt><dd className="am-mono">{detailRecord.accountNumber ?? '—'}</dd></div>
          </dl>
          {(detailRecord.decidedBy || detailRecord.decidedAt || detailRecord.adminNote || detailRecord.bankTransferStatus) && (
            <>
              <h3 className="dlg-sec-h">Decision</h3>
              <dl className="dlg-ledger">
                <div><dt>Decided by</dt><dd>{detailRecord.decidedBy ?? '—'}</dd></div>
                <div><dt>Decided on</dt><dd>{detailRecord.decidedAt ? dateTime(detailRecord.decidedAt) : '—'}</dd></div>
                {detailRecord.adminNote && <div><dt>{detailRecord.bankTransferStatus === 'manual' ? 'Transfer reference' : 'Reason given'}</dt><dd>{detailRecord.adminNote}</dd></div>}
                {detailRecord.bankTransferStatus && <div><dt>Paystack</dt><dd>{paystackLabel(detailRecord.bankTransferStatus)}</dd></div>}
              </dl>
            </>
          )}
        </Modal>
      )}

      {pinModal && (
        <Modal error={approveError || undefined} icon="withdraw" tone="money" title={manual ? 'Mark this withdrawal as paid?' : 'Approve this withdrawal?'} sub={manual ? 'Enter your approval PIN. Paystack is bypassed. Only confirm after you have paid the agent yourself.' : 'Enter your approval PIN. The money is sent through Paystack straight away.'}
          onClose={() => { setPinModal(null); setPinValue(''); setPinError(''); setApproveError('') }} busy={pinLoading}
          footnote={<><Icons.audit size={14} aria-hidden="true" /> Recorded in the audit log</>}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => { setPinModal(null); setPinValue(''); setPinError(''); setApproveError('') }} disabled={pinLoading}>Cancel</button>
            <button type="button" className="btn btn-green" disabled={pinLoading || !pinValue} onClick={confirmApprove}>{pinLoading ? (manual ? 'Saving…' : 'Sending…') : manual ? `Mark ${naira(pinModal.amount)} as paid` : `Approve and send ${naira(pinModal.amount)}`}</button>
          </>}>
          <AmountHero label="You’re sending" amount={naira(pinModal.amount)} sub={<>to <strong>{pinModal.agentName}</strong> · {pinModal.agentDisplayId}</>} />
          <Ledger>
            <LedgerRow label="Account name">{pinModal.accountName ?? '—'}</LedgerRow>
            <LedgerRow label="Bank">{pinModal.bankName ?? '—'} · {last4(pinModal.accountNumber)}</LedgerRow>
          </Ledger>
          <form onSubmit={e => { e.preventDefault(); confirmApprove() }} noValidate>
            {manual && (
              <Field id="wd-ref" label="Transfer reference (optional)" hint="Your bank transfer reference. It is saved with the payout.">
                <input id="wd-ref" className="a-input" type="text" maxLength={120} autoComplete="off"
                  value={transferRef} onChange={e => setTransferRef(e.target.value)} />
              </Field>
            )}
            <Field id="wd-pin" label="Approval PIN" error={pinError}>
              <input id="wd-pin" className="a-input am-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="off"
                value={pinValue} aria-invalid={!!pinError} placeholder="••••"
                onChange={e => { setPinValue(e.target.value); setPinError('') }} />
            </Field>
          </form>
        </Modal>
      )}

      {rejectModal && (
        <Modal error={rejectError || undefined} icon="report" tone="danger" title="Reject this withdrawal?" onClose={() => setRejectModal(null)} busy={rejectLoading}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={() => setRejectModal(null)} disabled={rejectLoading}>Cancel</button>
            <button type="button" className="btn btn-danger" disabled={rejectLoading} onClick={confirmReject}>{rejectLoading ? 'Rejecting…' : `Reject and refund ${naira(rejectModal.amount)}`}</button>
          </>}>
          <dl className="dlg-ledger">
            <div><dt>Amount</dt><dd className="dlg-strong">{naira(rejectModal.amount)}</dd></div>
            <div><dt>Agent</dt><dd>{rejectModal.agentName} · {rejectModal.agentDisplayId}</dd></div>
          </dl>
          <p className="dlg-note">Nothing is sent. The {naira(rejectModal.amount)} goes back into their commission balance.</p>
          <Field id="wd-reason" label="Reason (optional)" hint="The agent sees this, so say what to fix.">
            <textarea id="wd-reason" className="a-input" rows={3} value={rejectNote} onChange={e => setRejectNote(e.target.value)}
              placeholder="e.g. The account name doesn’t match yours. Update your bank details and ask again." />
          </Field>
        </Modal>
      )}

      {otpModal && (
        <Modal icon="locked" tone="money" title="Finish the Paystack payout" sub={`Paystack needs a one-time code to release ${naira(otpModal.amount)} to ${otpModal.agentName} (${otpModal.ref}). Paystack sends it by SMS to the phone on the Paystack account.`}
          onClose={() => { setOtpModal(null); setOtpValue('') }} busy={otpLoading}
          footer={<>
            <button type="button" className="btn btn-outline" disabled={otpLoading} onClick={() => { setOtpModal(null); setOtpValue('') }}>Later</button>
            <button type="button" className="btn btn-green" disabled={otpLoading || otpValue.length < 4} onClick={submitOtp}>{otpLoading ? 'Sending…' : 'Complete transfer'}</button>
          </>}>
          <form onSubmit={e => { e.preventDefault(); submitOtp() }} noValidate>
            <Field id="wd-otp" label="Code from Paystack" error={otpError} hint="If you close this, use Enter OTP on the request to come back.">
              <input id="wd-otp" className="a-input am-pin" type="tel" inputMode="numeric" maxLength={6} autoComplete="one-time-code"
                value={otpValue} aria-invalid={!!otpError} placeholder="000000" onKeyDown={blockNonDigit}
                onChange={e => { setOtpValue(digitsOnly(e.target.value).slice(0, 6)); setOtpError('') }} />
            </Field>
          </form>
        </Modal>
      )}

      {result && <ResultModal result={result} onClose={() => setResult(null)} />}
      {toastNode}
    </>
  )
}
