import { Icons } from '@/components/ui/icons'
import { BULK_SAVINGS_LABEL } from '@/lib/catchup'
import { formatNaira } from '@/lib/format'

export type PaymentNotice = { ref: string; count: number; weekly: boolean; reason: 'amount' | 'overlap'; amount: number }
export type HeldPayment = { ref: string; amount: number }

const MAX_SHOWN = 3

/** Things to keep telling a customer about their payments, past the screen they saw when they paid. */
export default function PaymentNotices({ notices = [], held = [], hideAmounts }: { notices?: PaymentNotice[]; held?: HeldPayment[]; hideAmounts: boolean }) {
  if (notices.length === 0 && held.length === 0) return null
  const money = (n: number) => (hideAmounts ? 'Your money' : formatNaira(n, { minor: false }))
  return (
    <>
      {held.map(h => (
        <p key={h.ref} className="ui-banner ui-banner--warn" role="status">
          <Icons.pending size={18} aria-hidden="true" />
          <span>We’re reviewing a payment{hideAmounts ? '' : ` of ${formatNaira(h.amount, { minor: false })}`}. It hasn’t been added to your plan yet. Please don’t pay it again.</span>
        </p>
      ))}
      {notices.slice(0, MAX_SHOWN).map(n => {
        const unit = `${n.weekly ? 'week' : 'day'}${n.count === 1 ? '' : 's'}`
        return (
          <p key={n.ref} className="ui-banner ui-banner--info" role="status">
            <Icons.pending size={18} aria-hidden="true" />
            <span>
              {n.reason === 'overlap'
                ? `${n.count} ${unit} you paid for had already been paid. ${money(n.amount)} stays in your savings, so nothing is lost.`
                : `${money(n.amount)} reached your savings, but the amount didn’t match, so ${n.count} ${unit} ${n.count === 1 ? 'is' : 'are'} still unpaid. You can pay through ${BULK_SAVINGS_LABEL}, and auto-funding may charge ${n.count === 1 ? 'it' : 'them'}.`}
            </span>
          </p>
        )
      })}
    </>
  )
}
