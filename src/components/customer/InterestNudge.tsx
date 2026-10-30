import { Icons } from '@/components/ui/icons'
import { formatDate, formatNaira } from '@/lib/format'

/** The interest fields /api/customer/me sends on each plan. Any of them may be missing. */
export type InterestFields = {
  source?: string
  status: string
  interest?: number
  nextInterestAmount?: number
  daysToNextInterest?: number | null
}

const HIDDEN = '₦ ••••'
const money = (n: number, hide: boolean) => (hide ? HIDDEN : formatNaira(n))

/** Only online (self-registered) plans earn interest; agent-run cash plans never show any. */
export const earnsInterest = (p: InterestFields) => p.source === 'self'

/** The next monthly credit, if the API says one is coming. */
function nextCredit(p: InterestFields) {
  const days = p.daysToNextInterest
  const amount = p.nextInterestAmount
  if (p.status !== 'Active' || typeof days !== 'number' || typeof amount !== 'number' || amount <= 0) return null
  return { days: Math.max(0, days), amount }
}

/** Small chip under the balance: "+₦4,500.00 interest earned". */
export function InterestChip({ plan, hideAmounts }: { plan: InterestFields; hideAmounts: boolean }) {
  if (!earnsInterest(plan) || typeof plan.interest !== 'number' || plan.interest <= 0) return null
  return <p className="ui-interest-chip">{hideAmounts ? HIDDEN : `+${formatNaira(plan.interest)}`} interest earned</p>
}

/** "Interest" card below the actions: earned so far, and when the next credit lands. */
export function InterestCard({ plan, hideAmounts }: { plan: InterestFields; hideAmounts: boolean }) {
  if (!earnsInterest(plan) || typeof plan.interest !== 'number') return null
  const next = nextCredit(plan)
  const lands = next ? new Date(Date.now() + next.days * 86400000) : null
  return (
    <>
      <div className="ui-section-head"><h2>Interest</h2></div>
      <section className="ui-card ui-card--list ui-interest">
        <dl className="ui-summary">
          <div className="ui-row">
            <dt className="ui-row-main">
              <span className="ui-row-title">Earned so far</span>
              <span className="ui-row-sub">Paid when you collect</span>
            </dt>
            <dd className="ui-row-value ui-amount--positive">{hideAmounts ? HIDDEN : `+${formatNaira(plan.interest)}`}</dd>
          </div>
          {next && lands && (
            <div className="ui-row">
              <dt className="ui-row-main">
                <span className="ui-row-title">Next credit</span>
                <span className="ui-row-sub">{formatDate(lands.toISOString())}</span>
              </dt>
              <dd className="ui-row-value ui-value-stack">
                <span>{money(next.amount, hideAmounts)}</span>
                <span className="ui-row-sub">{next.days === 0 ? 'lands today' : `in ${next.days} day${next.days === 1 ? '' : 's'}`}</span>
              </dd>
            </div>
          )}
        </dl>
        {next && (
          <p className="ui-nudge">
            <Icons.rate size={16} aria-hidden="true" />
            <span>Keep saving — interest is added every month you hold.</span>
          </p>
        )}
      </section>
    </>
  )
}

/** One line for a plan that has ended: what it earned. Nothing for cash plans or ₦0. */
export default function InterestNudge({ plan, hideAmounts }: { plan: InterestFields; hideAmounts: boolean }) {
  if (!earnsInterest(plan) || typeof plan.interest !== 'number' || plan.interest <= 0) return null
  return (
    <p className="ui-nudge">
      <Icons.rate size={16} aria-hidden="true" />
      <span>You’ve earned <strong>{money(plan.interest, hideAmounts)}</strong> in interest.</span>
    </p>
  )
}
