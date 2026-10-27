'use client'
import Amount, { useCountUp } from '@/components/ui/Amount'
import { Icons } from '@/components/ui/icons'
import { formatDate, formatNaira } from '@/lib/format'

type Plan = { balance: number; dailyAmount: number; periodDays: number; startDate: string; maturityDate: string; cadence?: string }

type Props = {
  plan: Plan
  hideAmounts: boolean
  onCollect: () => void
  onNewPlan: () => void
}

const RING = 208
const STROKE = 10
const R = (RING - STROKE) / 2
const CIRC = 2 * Math.PI * R

/**
 * A plan past its payout date. "Goal reached" only when the balance actually met the goal —
 * otherwise it says the plan ended, so we never congratulate someone for 3% of a goal.
 */
export default function PlanEnded({ plan, hideAmounts, onCollect, onNewPlan }: Props) {
  const goal = plan.dailyAmount * plan.periodDays
  const reached = goal > 0 && plan.balance >= goal
  // Same count-up as the amount in the middle, so the ring fills in step with the number.
  const animated = useCountUp(plan.balance, true, false)
  const pct = goal > 0 ? Math.min(1, animated / goal) : 0
  const months = Math.max(1, Math.round(plan.periodDays / 30))
  const span = plan.periodDays < 45 ? `${plan.periodDays} days` : `${months} months`
  const long = formatNaira(plan.balance).length > 10

  return (
    <>
      <p className={`ui-status ui-status--lg ${reached ? 'ui-status--success' : 'ui-status--neutral'}`}>
        {reached
          ? <><Icons.check size={16} aria-hidden="true" /> Goal reached</>
          : <>Plan ended {formatDate(plan.maturityDate)}</>}
      </p>

      <div className="ui-ring" role="img" aria-label={hideAmounts ? 'Savings ready to collect' : `${formatNaira(plan.balance)} saved of ${formatNaira(goal)} goal`}>
        <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true">
          <circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke="var(--ui-line)" strokeWidth={STROKE} />
          <circle
            cx={RING / 2} cy={RING / 2} r={R} fill="none"
            stroke="var(--ui-brand)" strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct)}
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
          />
        </svg>
        <div className="ui-ring-inner" aria-hidden="true">
          <span className="ui-ring-label">Ready to collect</span>
          {hideAmounts
            ? <span className="ui-amount ui-ring-amount">₦ ••••</span>
            : <span className={`ui-ring-amount${long ? ' ui-ring-amount--long' : ''}`}><Amount value={plan.balance} animate /></span>}
          <span className="ui-ring-label">of {formatNaira(goal, { minor: false })} goal</span>
        </div>
      </div>

      <p className="ui-hero-sub">
        {hideAmounts
          ? 'Your savings are ready to collect.'
          : reached
            ? <>You reached your {formatNaira(goal, { minor: false })} goal over {span}.</>
            : <>You saved <strong>{formatNaira(plan.balance)}</strong> over {span}.</>}
      </p>

      <div className="ui-plan-ended-actions">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--block" onClick={onCollect}>
          {hideAmounts ? 'Collect my savings' : `Collect ${formatNaira(plan.balance)}`}
        </button>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--block" onClick={onNewPlan}>
          <Icons.add size={18} aria-hidden="true" /> Start a new plan
        </button>
      </div>
    </>
  )
}

/** Plain facts about a finished plan (Copilot-style summary list). */
export function PlanSummary({ plan, hideAmounts }: { plan: Plan; hideAmounts: boolean }) {
  const goal = plan.dailyAmount * plan.periodDays
  const rate = (plan.cadence ?? 'daily') === 'weekly'
    ? `${formatNaira(plan.dailyAmount * 7, { minor: false })} weekly`
    : `${formatNaira(plan.dailyAmount, { minor: false })} daily`
  const rows: [string, string][] = [
    ['Saved', hideAmounts ? '₦ ••••' : formatNaira(plan.balance)],
    ['Goal', formatNaira(goal)],
    ['Saving', rate],
    ['Started', formatDate(plan.startDate)],
    ['Ended', formatDate(plan.maturityDate)],
  ]
  return (
    <>
      <div className="ui-section-head"><h2>Summary</h2></div>
      <dl className="ui-card ui-card--list ui-summary">
        {rows.map(([k, v]) => (
          <div key={k} className="ui-row">
            <dt className="ui-row-main ui-row-sub ui-summary-key">{k}</dt>
            <dd className="ui-row-value">{v}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}
