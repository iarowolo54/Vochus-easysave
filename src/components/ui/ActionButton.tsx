import { Icons, type IconName } from './icons'

type Props = {
  icon: IconName
  label: string
  onClick: () => void
  disabled?: boolean
}

/** Round primary action under a balance (Zopa: Add money / Withdraw / Open a pot). */
export default function ActionButton({ icon, label, onClick, disabled }: Props) {
  const Icon = Icons[icon]
  return (
    <button type="button" className="ui-action" onClick={onClick} disabled={disabled}>
      <span className="ui-action-circle" aria-hidden="true"><Icon size={24} /></span>
      {label}
    </button>
  )
}
