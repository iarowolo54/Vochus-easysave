import { Icons } from '@/components/ui/icons'

// Early-redemption statuses, in order. 'Approved' (paid out) never reaches the customer as pending.
const STEPS = [
  { label: 'Request sent', hint: '' },
  { label: 'Code confirmed', hint: 'Enter the code we sent you to confirm it’s you.' },
  { label: 'Agent approval', hint: 'Your agent is checking the request.' },
  { label: 'Final approval and payment', hint: 'Vochus is approving and sending your money.' },
] as const

// AwaitingOTP and Finalizing are the payout being sent: still the last step.
const CURRENT_STEP: Record<string, number> = { Pending: 1, TokenValidated: 2, AgentApproved: 3, AwaitingOTP: 3, Finalizing: 3 }

type Props = { status: string; onView: () => void }

export default function CollectionTracker({ status, onView }: Props) {
  const current = CURRENT_STEP[status] ?? 1
  return (
    <section className="ui-card" aria-label="Redemption progress">
      <div className="ui-card-head">
        <h2 className="ui-card-title">Redeeming your money</h2>
        <button type="button" className="ui-link" onClick={onView}>View <Icons.next size={16} aria-hidden="true" /></button>
      </div>
      <ol className="ui-steps">
        {STEPS.map((step, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo'
          return (
            <li key={step.label} className={`ui-step ui-step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="ui-step-dot" aria-hidden="true">{state === 'done' && <Icons.check size={14} />}</span>
              <span>
                <span className="ui-step-label">{step.label}</span>
                {state === 'current' && step.hint && <span className="ui-step-hint">{step.hint}</span>}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="ui-card-note">New savings are paused until this is finished.</p>
    </section>
  )
}
